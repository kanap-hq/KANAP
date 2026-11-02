import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { Features } from '../../config/features';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import {
  TRIAL_SIGNUP_RETENTION_DAYS,
  TRIAL_SIGNUP_RETENTION_TASK_NAME,
  TrialSignupRetentionService,
} from '../trial-signup-retention.service';

// Retention of trial sign-ups, on a real database, in a rolled-back transaction.
// The daily task deletes an unactivated sign-up once COALESCE(last_email_sent_at,
// created_at) is older than 90 days, and an activated sign-up once its workspace
// is gone and the deletion (or the activation, when no deleted tenant matches)
// is older than 90 days. A live workspace is kept, and a deleted tenant of slug
// `ab-123` (`deleted-ab-123-<digits>`) does not release the sign-up of slug `ab`.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const DELETED = ['abandoned-old', 'gone-old', 'orphan-old'];
const KEPT = [
  'abandoned-young',
  'abandoned-resent',
  'live-ws',
  'gone-young',
  'ab',
  'a_b',
  'frozen-ws',
  'resigned',
  'orphan-young',
];

async function retargetTenant(
  runner: QueryRunner,
  id: string,
  slug: string,
  status: string,
  deletedDays: number | null,
) {
  await runner.query(
    `UPDATE tenants
        SET slug = $2,
            status = $3,
            deleted_at = CASE WHEN $4::bool THEN now() - make_interval(days => $5::int) ELSE NULL END
      WHERE id = $1`,
    [id, slug, status, deletedDays != null, deletedDays ?? 0],
  );
}

async function insertSignup(
  runner: QueryRunner,
  slug: string,
  opts: { createdDays: number; emailDays: number | null; activatedDays: number | null },
) {
  await runner.query(
    `INSERT INTO trial_signups (org_name, slug, email, country_iso, first_name, last_name,
        activated_at, last_email_sent_at, created_at, updated_at)
     VALUES ($1, $2, $3, 'FR', 'Ada', 'Lovelace',
        CASE WHEN $4::bool THEN now() - make_interval(days => $5::int) ELSE NULL END,
        CASE WHEN $6::bool THEN now() - make_interval(days => $7::int) ELSE NULL END,
        now() - make_interval(days => $8::int), now())`,
    [
      `Org ${slug}`, slug, `${slug}@retention.example`,
      opts.activatedDays != null, opts.activatedDays ?? 0,
      opts.emailDays != null, opts.emailDays ?? 0,
      opts.createdDays,
    ],
  );
}

async function signupSlugs(runner: QueryRunner): Promise<string[]> {
  const rows: Array<{ slug: string }> = await runner.query(`SELECT slug::text AS slug FROM trial_signups`);
  return rows.map((row) => row.slug).sort();
}

async function signupCount(runner: QueryRunner): Promise<number> {
  const rows: Array<{ n: number }> = await runner.query(`SELECT count(*)::int AS n FROM trial_signups`);
  return Number(rows[0]?.n ?? 0);
}

async function testTaskRegistersOnlyInMultiTenantMode() {
  assert.equal(TRIAL_SIGNUP_RETENTION_DAYS, 90);
  const saved = Features.SINGLE_TENANT;
  const registered: any[] = [];
  const task = new TrialSignupRetentionService(dataSource, { register: (reg: any) => registered.push(reg) } as any);
  try {
    (Features as any).SINGLE_TENANT = false;
    task.onModuleInit();
    assert.equal(registered.length, 1);
    assert.equal(registered[0].name, TRIAL_SIGNUP_RETENTION_TASK_NAME);
    assert.equal(registered[0].defaultCron, '50 3 * * *');
    assert.match(registered[0].description, /90 days/);

    (Features as any).SINGLE_TENANT = true;
    task.onModuleInit();
    assert.equal(registered.length, 1, 'single-tenant mode does not register the task');
  } finally {
    (Features as any).SINGLE_TENANT = saved;
  }
}

async function testRetentionDeletesAbandonedAndLeftoverSignups() {
  await inRolledBackTransaction(async (runner) => {
    const live = await seedTenant(runner, 'trial-retention-live');
    const goneOld = await seedTenant(runner, 'trial-retention-gone-old');
    const goneYoung = await seedTenant(runner, 'trial-retention-gone-young');
    const goneYoungEarlier = await seedTenant(runner, 'trial-retention-gone-young-earlier');
    const ab123 = await seedTenant(runner, 'trial-retention-ab-123');
    const underscoreTrap = await seedTenant(runner, 'trial-retention-underscore');
    const frozen = await seedTenant(runner, 'trial-retention-frozen');
    const resigned = await seedTenant(runner, 'trial-retention-resigned');
    const resignedOld = await seedTenant(runner, 'trial-retention-resigned-old');

    await retargetTenant(runner, live, 'live-ws', 'active', null);
    await retargetTenant(runner, goneOld, 'deleted-gone-old-1700000000001', 'deleted', 91);
    await retargetTenant(runner, goneYoung, 'deleted-gone-young-1700000000002', 'deleted', 89);
    await retargetTenant(runner, goneYoungEarlier, 'deleted-gone-young-1700000000003', 'deleted', 200);
    // The slug deleteTenant writes for workspace `ab-123`. It must not count as the deletion of `ab`.
    await retargetTenant(runner, ab123, 'deleted-ab-123-1700000000004', 'deleted', 91);
    // `deleted-a_b-%` would match this slug if `_` were a LIKE wildcard.
    await retargetTenant(runner, underscoreTrap, 'deleted-axb-1700000000005', 'deleted', 200);
    await retargetTenant(runner, frozen, 'frozen-ws', 'frozen', null);
    await retargetTenant(runner, resigned, 'resigned', 'active', null);
    await retargetTenant(runner, resignedOld, 'deleted-resigned-1700000000006', 'deleted', 200);

    const signups: Array<[string, { createdDays: number; emailDays: number | null; activatedDays: number | null }]> = [
      ['abandoned-old', { createdDays: 200, emailDays: 91, activatedDays: null }],
      ['abandoned-young', { createdDays: 89, emailDays: null, activatedDays: null }],
      ['abandoned-resent', { createdDays: 200, emailDays: 1, activatedDays: null }],
      ['live-ws', { createdDays: 200, emailDays: 200, activatedDays: 200 }],
      ['gone-old', { createdDays: 200, emailDays: 200, activatedDays: 200 }],
      ['gone-young', { createdDays: 200, emailDays: 200, activatedDays: 200 }],
      ['ab', { createdDays: 100, emailDays: 100, activatedDays: 89 }],
      ['a_b', { createdDays: 100, emailDays: 100, activatedDays: 30 }],
      ['frozen-ws', { createdDays: 200, emailDays: 200, activatedDays: 200 }],
      ['resigned', { createdDays: 200, emailDays: 200, activatedDays: 200 }],
      ['orphan-old', { createdDays: 100, emailDays: 100, activatedDays: 91 }],
      ['orphan-young', { createdDays: 100, emailDays: 100, activatedDays: 89 }],
    ];
    for (const [slug, opts] of signups) await insertSignup(runner, slug, opts);

    const lines: string[] = [];
    const task = new TrialSignupRetentionService(dataSource, { register: () => undefined } as any);
    (task as any).logger = {
      log: (line: string) => lines.push(String(line)),
      warn: (line: string) => lines.push(`warn:${line}`),
    };

    const before = await signupCount(runner);
    assert.equal(before, signups.length, 'the spec database has no other sign-ups');
    const wide = await task.run({ manager: runner.manager, days: 1000 });
    assert.equal(wide.purged, 0);
    assert.deepEqual(lines.slice(), []);
    assert.deepEqual(await signupSlugs(runner), signups.map(([slug]) => slug).sort());

    const summary = await task.run({ manager: runner.manager });
    const remaining = await signupSlugs(runner);
    assert.equal(summary.purged, before - remaining.length);
    assert.equal(summary.purged, DELETED.length);
    assert.deepEqual(remaining, [...KEPT].sort());
    assert.deepEqual(lines.slice(), [`[${TRIAL_SIGNUP_RETENTION_TASK_NAME}] ${DELETED.length} sign-up(s) purged`]);
    for (const slug of [...DELETED, ...KEPT]) assert.equal(lines.some((line) => line.includes(slug)), false, slug);
    assert.equal(lines.some((line) => line.includes('@')), false);

    lines.length = 0;
    const again = await task.run({ manager: runner.manager });
    assert.equal(again.purged, 0);
    assert.deepEqual(lines.slice(), []);
    assert.deepEqual(await signupSlugs(runner), [...KEPT].sort());
  });
}

runSpecs('trial signup retention', [
  ['the task registers in multi-tenant mode and not in single-tenant mode', testTaskRegistersOnlyInMultiTenantMode],
  ['the retention task deletes abandoned sign-ups and sign-ups left by a deleted workspace after 90 days', testRetentionDeletesAbandonedAndLeftoverSignups],
]);
