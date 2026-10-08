import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import { Features } from '../../config/features';
import { PublicController } from '../public.controller';
import { TrialSignup } from '../trial-signup.entity';
import {
  ActivatedTenant,
  baselineSnapshot,
  buildServices,
  cleanupTenants,
  countDifferences,
  countTenantRows,
  createActivatedTenant,
  runSpecs,
} from '../../admin/tenants/__tests__/tenant-reset-test-helpers';

// Trial activation against a real database, compared with the test helper that the tenant reset
// specs use as "a tenant just activated" (tenant-reset-test-helpers.ts): same rows in every
// tenant table, same starting state. Keeps the helper from drifting away from activation.

async function withActivationConfig<T>(fn: () => Promise<T>): Promise<T> {
  const savedUrl = process.env.APP_BASE_URL;
  const savedSingleTenant = Features.SINGLE_TENANT;
  process.env.APP_BASE_URL = 'https://kanap.example.test';
  (Features as any).SINGLE_TENANT = false;
  try {
    return await fn();
  } finally {
    if (savedUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = savedUrl;
    (Features as any).SINGLE_TENANT = savedSingleTenant;
  }
}

async function testActivationMatchesHelper() {
  const svc = buildServices();
  const sent: string[] = [];
  const controller = new PublicController(
    svc.tenants,
    svc.users,
    svc.baseline,
    dataSource,
    { send: async (message: { to: string }) => { sent.push(message.to); } } as any,
    svc.auth,
    dataSource.getRepository(TrialSignup),
    {} as any,
    {} as any,
    {} as any,
  );
  const token = randomBytes(32).toString('hex');
  const slug = `rs-act-${randomUUID().slice(0, 8)}`;
  let activatedId: string | undefined;
  let helper: ActivatedTenant | undefined;
  try {
    await dataSource.query(
      `INSERT INTO trial_signups (org_name, slug, email, country_iso, token_hash, expires_at)
       VALUES ('Activation Org', $1, $2, 'DE', $3, now() + interval '1 hour')`,
      [slug, `owner-${slug}@reset-spec.test`, createHash('sha256').update(token, 'utf8').digest('hex')],
    );
    const result = await withActivationConfig(() =>
      controller.activateTrial({ token }, { protocol: 'https', headers: { host: 'kanap.example.test' } }));
    assert.ok(result.reset_token, 'activation answers with the password link');
    assert.deepEqual(sent, ['admin@kanap.net']);
    const [tenant] = await dataSource.query(`SELECT id FROM tenants WHERE slug = $1 AND deleted_at IS NULL`, [slug]);
    activatedId = tenant.id;

    helper = await createActivatedTenant(svc, { tag: 'act-h', orgName: 'Activation Org', countryIso: 'DE' });

    const activated = await countTenantRows(activatedId!);
    const helped = await countTenantRows(helper.tenantId);
    assert.deepEqual(countDifferences(activated, helped), [], 'row counts per table, activation vs helper');
    assert.ok(activated.chart_of_accounts === 1 && activated.accounts > 0, 'activation provisioned the chart of accounts');
    assert.deepEqual(await baselineSnapshot(helper.tenantId), await baselineSnapshot(activatedId!));
  } finally {
    const created = await dataSource.query(`SELECT id FROM tenants WHERE slug = $1`, [slug]);
    await cleanupTenants([...created.map((row: { id: string }) => row.id), helper?.tenantId]);
    await dataSource.query(`DELETE FROM trial_signups WHERE slug = $1`, [slug]);
  }
}

runSpecs('activate-trial-baseline.integration.spec', [testActivationMatchesHelper]).catch((err) => {
  console.error(err);
  process.exit(1);
});
