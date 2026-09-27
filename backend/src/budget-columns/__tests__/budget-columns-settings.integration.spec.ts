import 'reflect-metadata';
import 'dotenv/config';
import { BadRequestException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { Tenant } from '../../tenants/tenant.entity';
import { FxIngestionService } from '../../currency/fx-ingestion.service';
import { BudgetColumnsService } from '../budget-columns.service';
import { BudgetColumnsController } from '../budget-columns.controller';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { applyBudgetColumnsPatch, DEFAULT_BUDGET_COLUMNS, normalizeBudgetColumns } from '../budget-columns.util';
import {
  assert,
  captureAudit,
  inRolledBackTransaction,
  runSpecs,
  seedTenant,
  setBudgetColumns,
} from '../../spend/__tests__/round-inputs.fixtures';

// The tenant's budget column settings: defaults, partial updates that keep
// every other metadata key, validation, audit, tolerant reads, the request
// tenant as the only source of the tenant id, and the login FX refresh that
// must not erase them.

const DEFAULTS = {
  labels: { planned: null, committed: null, forecast: null, actual: null, expected_landing: null },
  enabled: { planned: true, committed: true, forecast: false, actual: true, expected_landing: true },
  group_spread: { planned: true, committed: true, forecast: true, actual: true, expected_landing: true },
  default_column: 'planned',
};

const OTHER_METADATA = {
  reporting_currency: 'USD',
  it_ops: { application_categories: [{ code: 'x', label: 'X' }] },
  fx_last_login_refresh_at: '2000-01-01T00:00:00.000Z',
};

function service(runner: QueryRunner, audit = captureAudit()) {
  return new BudgetColumnsService(runner.manager.getRepository(Tenant), audit as any);
}

async function metadata(runner: QueryRunner, tenantId: string): Promise<Record<string, any>> {
  const [row] = await runner.query(`SELECT metadata FROM tenants WHERE id = $1`, [tenantId]);
  return row.metadata;
}

function refusedWith(message: string) {
  return (err: any) => {
    assert.ok(err instanceof BadRequestException, `expected a 400, got ${err}`);
    assert.equal(err.message, message);
    return true;
  };
}

/** Pure validation: the rules of R2 on the merged object. */
async function testValidation() {
  assert.deepEqual(DEFAULT_BUDGET_COLUMNS, DEFAULTS);
  assert.deepEqual(normalizeBudgetColumns(undefined), DEFAULTS);
  const apply = (patch: unknown) => applyBudgetColumnsPatch(normalizeBudgetColumns(undefined), patch);

  const renamed = apply({ labels: { planned: '  A0 \t budget ', committed: '   ' } });
  assert.equal(renamed.labels.planned, 'A0 budget', 'trimmed, inner whitespace collapsed');
  assert.equal(renamed.labels.committed, null, 'blank is the product name');
  assert.equal(apply({ labels: { planned: 'x'.repeat(40) } }).labels.planned, 'x'.repeat(40));
  assert.throws(() => apply({ labels: { planned: 'x'.repeat(41) } }), refusedWith('A column name can have at most 40 characters.'));
  assert.throws(() => apply({ labels: { planned: 'A\u0007' } }), BadRequestException, 'control characters');
  for (const invisible of ['\u200B', 'Budget\u200B', '\u200EA0', 'A\u202E0', '\u2066A0\u2069', '\uFEFFA0']) {
    assert.throws(
      () => apply({ labels: { committed: invisible } }),
      refusedWith('A column name cannot contain invisible characters.'),
      `format character in ${JSON.stringify(invisible)}`,
    );
  }
  assert.equal(normalizeBudgetColumns({ labels: { planned: 'A\u200B0' } }).labels.planned, null, 'a stored invisible name falls back');
  assert.throws(() => apply({ labels: { planned: 5 } }), BadRequestException, 'a name must be text');
  assert.throws(() => apply({ labels: { planned: 'Same', committed: 'sAME' } }), refusedWith('Two columns cannot both be named "sAME".'));
  assert.throws(() => apply({ labels: { committed: 'budget' } }), refusedWith('Two columns cannot both be named "budget".'), 'a product name counts');
  assert.equal(apply({ labels: { planned: 'Revision', committed: 'Budget' } }).labels.committed, 'Budget', 'swapping names is fine');

  assert.throws(
    () => apply({ enabled: { planned: false, committed: false, actual: false, expected_landing: false } }),
    refusedWith('At least one column must stay shown.'),
  );
  assert.throws(() => apply({ enabled: { planned: false } }), refusedWith('The default column must be shown: choose another default column first.'));
  assert.throws(() => apply({ default_column: 'forecast' }), refusedWith('The default column must be shown: choose another default column first.'));
  const moved = apply({ default_column: 'committed', enabled: { planned: false } });
  assert.deepEqual([moved.default_column, moved.enabled.planned], ['committed', false], 'default moved and old default hidden in one patch');
  assert.deepEqual(apply({ group_spread: {} }).group_spread, DEFAULTS.group_spread);
  assert.deepEqual(
    apply({ group_spread: { planned: false, committed: false, forecast: false, actual: false, expected_landing: false } }).group_spread,
    { planned: false, committed: false, forecast: false, actual: false, expected_landing: false },
    'an empty group is allowed',
  );

  assert.throws(() => apply({ colours: {} }), BadRequestException, 'unknown setting');
  assert.throws(() => apply({ labels: { budget: 'A0' } }), BadRequestException, 'unknown column');
  assert.throws(() => apply({ enabled: { forecast: 'yes' } }), BadRequestException, 'non-boolean flag');
  assert.throws(() => apply({ default_column: 'budget' }), BadRequestException, 'default by API name');
  assert.throws(() => apply([]), BadRequestException, 'not an object');

  // Tolerant read of a hand-edited object: field by field.
  const broken = normalizeBudgetColumns({
    labels: { planned: 'A0', committed: 'a0', forecast: 'x'.repeat(60), actual: 7 },
    enabled: { planned: false, committed: false, forecast: false, actual: false, expected_landing: false },
    group_spread: { actual: false, forecast: 'no' },
    default_column: 'forecast',
  });
  assert.deepEqual(broken.labels, { planned: 'A0', committed: null, forecast: null, actual: null, expected_landing: null });
  assert.deepEqual(broken.enabled, DEFAULTS.enabled, 'no shown column: default shown columns');
  assert.deepEqual(broken.group_spread, { ...DEFAULTS.group_spread, actual: false });
  assert.equal(broken.default_column, 'planned', 'a hidden default moves to the first shown column');
  assert.equal(normalizeBudgetColumns({ enabled: { planned: false }, default_column: 'planned' }).default_column, 'committed');
}

/** Service against the database: defaults, partial updates, other metadata kept, audit only on change. */
async function testReadAndUpdate() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'cols-rw');
    await runner.query(`UPDATE tenants SET metadata = $2::jsonb WHERE id = $1`, [tenantId, JSON.stringify(OTHER_METADATA)]);
    const audit = captureAudit();
    const svc = service(runner, audit);

    assert.deepEqual(await svc.get(tenantId, runner.manager), DEFAULTS, 'a tenant without the key gets the defaults');

    const first = await svc.update(tenantId, { labels: { forecast: ' A2 ' }, enabled: { forecast: true } }, 'user-1', runner.manager);
    assert.deepEqual(first, { ...DEFAULTS, labels: { ...DEFAULTS.labels, forecast: 'A2' }, enabled: { ...DEFAULTS.enabled, forecast: true } });
    const second = await svc.update(tenantId, { group_spread: { actual: false }, default_column: 'forecast' }, 'user-1', runner.manager);
    assert.equal(second.labels.forecast, 'A2', 'a partial update keeps the other fields');
    assert.deepEqual([second.group_spread.actual, second.default_column], [false, 'forecast']);

    const stored = await metadata(runner, tenantId);
    assert.deepEqual(stored.budget_columns, second, 'the full normalised object is stored');
    for (const [key, value] of Object.entries(OTHER_METADATA)) assert.deepEqual(stored[key], value, `${key} is kept`);
    assert.deepEqual(await svc.get(tenantId, runner.manager), second);

    assert.equal(audit.entries.length, 2);
    assert.deepEqual(
      [audit.entries[0].table, audit.entries[0].recordId, audit.entries[0].action, audit.entries[0].userId],
      ['tenants', tenantId, 'update', 'user-1'],
    );
    assert.deepEqual([audit.entries[0].before, audit.entries[0].after], [DEFAULTS, first]);
    await svc.update(tenantId, { labels: { forecast: 'A2' } }, 'user-1', runner.manager);
    await svc.update(tenantId, {}, 'user-1', runner.manager);
    assert.equal(audit.entries.length, 2, 'no audit row when nothing changes');

    // A refused patch writes nothing and leaves the transaction usable.
    await assert.rejects(
      () => svc.update(tenantId, { enabled: { forecast: false } }, 'user-1', runner.manager),
      refusedWith('The default column must be shown: choose another default column first.'),
    );
    await assert.rejects(() => svc.update(tenantId, { labels: { planned: 'a2' } }, 'user-1', runner.manager), refusedWith('Two columns cannot both be named "A2".'));
    assert.deepEqual((await metadata(runner, tenantId)).budget_columns, second);

    // A hand-edited stored object is read tolerantly and repaired on the next save.
    await setBudgetColumns(runner, tenantId, { enabled: { planned: 'yes' }, default_column: 'nope', labels: { planned: 'x'.repeat(99) } });
    assert.deepEqual(await svc.get(tenantId, runner.manager), DEFAULTS);
    assert.deepEqual(await svc.update(tenantId, { labels: { actual: 'Réel' } }, null, runner.manager), { ...DEFAULTS, labels: { ...DEFAULTS.labels, actual: 'Réel' } });
  });
}

/**
 * `tenants` has no RLS: the settings are read and written by id, and the only
 * source of that id is the request's resolved tenant (never the body or query).
 */
async function testControllerUsesTheRequestTenant() {
  const calls: unknown[][] = [];
  const stub = {
    get: async (...args: unknown[]) => { calls.push(['get', ...args]); return DEFAULTS; },
    update: async (...args: unknown[]) => { calls.push(['update', ...args]); return DEFAULTS; },
  };
  const controller = new BudgetColumnsController(stub as any);
  const manager = { tag: 'request manager' };
  const req = { tenant: { id: 'tenant-a' }, user: { sub: 'user-1' }, queryRunner: { manager }, query: { tenantId: 'tenant-b' } };
  await controller.get(req);
  await controller.update({ labels: { planned: 'A0' }, tenant_id: 'tenant-b' }, req);
  assert.deepEqual(calls, [
    ['get', 'tenant-a', manager],
    ['update', 'tenant-a', { labels: { planned: 'A0' }, tenant_id: 'tenant-b' }, 'user-1', manager],
  ]);
  await assert.rejects(() => controller.get({ query: { tenantId: 'tenant-b' } }), /Tenant context is required/);
  await assert.rejects(() => controller.update({}, { user: { sub: 'user-1' } }), /Tenant context is required/);
  assert.equal(calls.length, 2, 'nothing is read or written without a request tenant');
  // A tenant_id in the body is not a setting: the service refuses it.
  assert.throws(() => applyBudgetColumnsPatch(normalizeBudgetColumns(undefined), { tenant_id: 'tenant-b' }), BadRequestException);

  // Reading is open to every member; writing needs Budget administration admin.
  assert.equal(Reflect.getMetadata(REQUIRE_LEVEL_KEY, BudgetColumnsController.prototype.get), undefined);
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, BudgetColumnsController.prototype.update), { resource: 'budget_ops', level: 'admin' });
}

/** The login FX refresh merges its own keys: a settings save made meanwhile survives. */
async function testLoginFxRefreshKeepsSettings() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'cols-fx');
    await runner.query(`UPDATE tenants SET metadata = $2::jsonb WHERE id = $1`, [tenantId, JSON.stringify(OTHER_METADATA)]);
    const fx = new FxIngestionService({ manager: runner.manager } as any, undefined as any, undefined as any, undefined as any, undefined as any);
    // The settings are saved while the refresh is queued, after it read the metadata.
    (fx as any).queueManualRefresh = async () => {
      await service(runner).update(tenantId, { labels: { planned: 'A0' } }, null, runner.manager);
      return 'queued';
    };
    await fx.maybeRefreshOnLogin(tenantId);
    const stored = await metadata(runner, tenantId);
    assert.equal(stored.budget_columns?.labels?.planned, 'A0', 'the settings saved meanwhile are kept');
    assert.equal(stored.fx_last_login_refresh_label, 'login-auto');
    assert.notEqual(stored.fx_last_login_refresh_at, OTHER_METADATA.fx_last_login_refresh_at, 'the refresh keys are written');
    assert.deepEqual([stored.reporting_currency, stored.it_ops], [OTHER_METADATA.reporting_currency, OTHER_METADATA.it_ops]);
  });
}

void runSpecs('budget-columns-settings.integration.spec', [
  ['testValidation', testValidation],
  ['testReadAndUpdate', testReadAndUpdate],
  ['testControllerUsesTheRequestTenant', testControllerUsesTheRequestTenant],
  ['testLoginFxRefreshKeepsSettings', testLoginFxRefreshKeepsSettings],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
