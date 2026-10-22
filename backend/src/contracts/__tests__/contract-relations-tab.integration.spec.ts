// @database-spec
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { ContractsController } from '../contracts.controller';
import { ContractsService } from '../contracts.service';
import { assert, captureAudit, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';

// GET/POST/DELETE /contracts/:id/relations (lot R2b), on an empty migrated database:
// the tab in one round trip, the supplier suggestions, one link at a time and its audit,
// the refusals, and a contract of another tenant.

type Ref = { id: string; reference: string };

type Seed = {
  tenantId: string;
  userId: string;
  supplierId: string;
  contractId: string;
  bareContractId: string;
  apps: {
    alpha: Ref;
    mid: Ref;
    suggested: Ref;
    outOfScope: Ref;
    disabled: Ref;
    ended: Ref;
    otherSupplier: Ref;
  };
  assets: {
    alpha: Ref;
    mid: Ref;
    suggested: Ref;
    retired: Ref;
    otherVendor: Ref;
  };
  techs: { alpha: Ref; mid: Ref };
};

function contracts(audit = captureAudit()): ContractsService {
  const args: any[] = Array.from({ length: 9 }, () => undefined);
  args[4] = audit;
  return new (ContractsService as any)(...args);
}

function controller(audit = captureAudit()) {
  const svc = contracts(audit);
  return { audit, svc, controller: new ContractsController(svc, undefined as any, undefined as any, undefined as any) };
}

function req(runner: QueryRunner, seed: Seed, permissions: Record<string, string>, userId: string | null = null) {
  return {
    queryRunner: { manager: runner.manager },
    user: { sub: userId },
    tenant: { id: seed.tenantId },
    isAdmin: false,
    permissions,
  };
}

const READ = { contracts: 'reader', infrastructure: 'reader', applications: 'reader' };
const WRITE = { contracts: 'member', infrastructure: 'reader' };

async function rejection(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected a refusal');
}

async function seedTab(runner: QueryRunner, tag: string): Promise<Seed> {
  const tenantId = await seedTenant(runner, tag);
  const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0];
  const roleId = (await one(
    `INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Business Contributor') RETURNING id`,
    [tenantId],
  )).id as string;
  const userId = (await one(
    `INSERT INTO users (tenant_id, email, role_id, first_name, last_name) VALUES ($1, $2, $3, 'Ada', 'Martin') RETURNING id`,
    [tenantId, `ctab-${tag}-${tenantId.slice(0, 8)}@example.test`, roleId],
  )).id as string;
  const companyId = (await one(
    `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, $2, 'FR', 'Lyon') RETURNING id`,
    [tenantId, `Tab company ${tag}`],
  )).id as string;
  const supplierId = (await one(
    `INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`,
    [tenantId, `Tab supplier ${tag}`],
  )).id as string;
  const otherSupplierId = (await one(
    `INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`,
    [tenantId, `Other supplier ${tag}`],
  )).id as string;
  const contract = (name: string, supplier: string) => one(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, $2, $3, $4, DATE '2026-01-01') RETURNING id`,
    [tenantId, name, companyId, supplier],
  ).then((row) => row.id as string);
  const contractId = await contract(`Tab contract ${tag}`, supplierId);
  const bareContractId = await contract(`Bare contract ${tag}`, supplierId);

  const application = async (name: string, supplier: string, columns: { lifecycle?: string; criticality?: string | null; status?: string; ended?: boolean }) => {
    const row = await one(
      `INSERT INTO applications (tenant_id, name, supplier_id, lifecycle, criticality, status, disabled_at)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7::bool THEN now() - interval '1 day' ELSE NULL END)
       RETURNING id, sequential_id AS reference`,
      [tenantId, name, supplier, columns.lifecycle ?? 'active', columns.criticality ?? null, columns.status ?? 'enabled', columns.ended === true],
    );
    return { id: row.id as string, reference: row.reference as string };
  };
  const alpha = await application('Alpha app', supplierId, { criticality: 'high' });
  const mid = await application('Mid app', supplierId, { lifecycle: 'proposed' });
  const suggested = await application('Cedar app', supplierId, {});
  const outOfScope = await application('Delta app', supplierId, {});
  const disabled = await application('Old app', supplierId, { status: 'disabled' });
  const ended = await application('Ended app', supplierId, { ended: true });
  const otherSupplier = await application('Other app', otherSupplierId, {});
  await runner.query(
    `INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`,
    [tenantId, suggested.id, userId],
  );
  await runner.query(
    `INSERT INTO application_contracts (tenant_id, contract_id, application_id) VALUES ($1, $2, $3), ($1, $2, $4)`,
    [tenantId, contractId, alpha.id, mid.id],
  );

  const asset = async (name: string, kind: string, environment: string, status: string) => {
    const row = await one(
      `INSERT INTO assets (tenant_id, name, kind, environment, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now(), now()) RETURNING id, asset_reference AS reference`,
      [tenantId, name, kind, environment, status],
    );
    return { id: row.id as string, reference: row.reference as string };
  };
  const assetAlpha = await asset('Alpha srv', 'physical_server', 'prod', 'active');
  const assetMid = await asset('Mid srv', 'virtual_machine', 'test', 'standby');
  const assetSuggested = await asset('Echo srv', 'physical_server', 'prod', 'active');
  const retired = await asset('Old srv', 'physical_server', 'prod', 'retired');
  const otherVendor = await asset('Other srv', 'physical_server', 'prod', 'active');
  const support = (assetId: string, vendorId: string) => runner.query(
    `INSERT INTO asset_support_info (tenant_id, asset_id, vendor_id) VALUES ($1, $2, $3)`,
    [tenantId, assetId, vendorId],
  );
  await support(assetAlpha.id, supplierId);
  await support(assetMid.id, supplierId);
  await support(assetSuggested.id, supplierId);
  await support(retired.id, supplierId);
  await support(otherVendor.id, otherSupplierId);
  await runner.query(
    `INSERT INTO asset_contracts (tenant_id, contract_id, asset_id) VALUES ($1, $2, $3), ($1, $2, $4)`,
    [tenantId, contractId, assetAlpha.id, assetMid.id],
  );

  const tech = async (n: number, name: string, family: string, editor: string | null) => {
    const row = await one(
      `INSERT INTO technologies (tenant_id, item_number, name, family, editor) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tenantId, n, name, family, editor],
    );
    return { id: row.id as string, reference: `TEC-${n}` };
  };
  const techAlpha = await tech(1, 'Alpha tech', 'database', 'Oracle');
  const techMid = await tech(2, 'Mid tech', 'runtime', null);
  await runner.query(
    `INSERT INTO technology_contracts (tenant_id, technology_id, contract_id) VALUES ($1, $2, $3), ($1, $4, $3)`,
    [tenantId, techAlpha.id, contractId, techMid.id],
  );

  return {
    tenantId,
    userId,
    supplierId,
    contractId,
    bareContractId,
    apps: { alpha, mid, suggested, outOfScope, disabled, ended, otherSupplier },
    assets: { alpha: assetAlpha, mid: assetMid, suggested: assetSuggested, retired, otherVendor },
    techs: { alpha: techAlpha, mid: techMid },
  };
}

async function testPayload() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'ctab-payload');
    const { controller: http } = controller();
    const res = await http.relations(seed.contractId, req(runner, seed, READ));

    assert.deepEqual(Object.keys(res).sort(), ['applications', 'assets', 'suggestions', 'technologies']);
    assert.deepEqual(res.applications, [
      {
        id: seed.apps.alpha.id, reference: seed.apps.alpha.reference, name: 'Alpha app',
        lifecycle: 'active', business_criticality: 'high', status: 'enabled',
      },
      {
        id: seed.apps.mid.id, reference: seed.apps.mid.reference, name: 'Mid app',
        lifecycle: 'proposed', business_criticality: null, status: 'enabled',
      },
    ]);
    assert.match(seed.apps.alpha.reference, /^APP-\d+$/);
    assert.deepEqual(res.assets, [
      {
        id: seed.assets.alpha.id, reference: seed.assets.alpha.reference, name: 'Alpha srv',
        kind: 'physical_server', environment: 'prod', status: 'active',
      },
      {
        id: seed.assets.mid.id, reference: seed.assets.mid.reference, name: 'Mid srv',
        kind: 'virtual_machine', environment: 'test', status: 'standby',
      },
    ]);
    assert.match(seed.assets.alpha.reference, /^AST-\d+$/);
    assert.deepEqual(res.technologies, [
      { id: seed.techs.alpha.id, reference: 'TEC-1', name: 'Alpha tech', family: 'database', vendor: 'Oracle' },
      { id: seed.techs.mid.id, reference: 'TEC-2', name: 'Mid tech', family: 'runtime', vendor: null },
    ]);

    const byId = new Map(res.suggestions.map((row) => [row.id, row]));
    assert.deepEqual(byId.get(seed.apps.suggested.id), {
      type: 'application', id: seed.apps.suggested.id, reference: seed.apps.suggested.reference, name: 'Cedar app',
      via: { kind: 'same_supplier', label: null },
    });
    assert.deepEqual(byId.get(seed.assets.suggested.id)?.via, { kind: 'same_supplier', label: null });
    assert.deepEqual(res.suggestions.map((row) => row.name), ['Cedar app', 'Delta app', 'Echo srv']);
    for (const excluded of [seed.apps.alpha.id, seed.apps.mid.id, seed.apps.disabled.id, seed.apps.ended.id, seed.apps.otherSupplier.id, seed.assets.alpha.id, seed.assets.mid.id, seed.assets.retired.id, seed.assets.otherVendor.id]) {
      assert.ok(!byId.has(excluded), `excluded ${excluded}`);
    }
  });
}

async function testSuggestions() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'ctab-suggest');
    const { controller: http } = controller();

    // No read of the infrastructure: the technologies are null, and no asset is suggested.
    const hidden = await http.relations(seed.contractId, req(runner, seed, { contracts: 'reader', applications: 'reader' }));
    assert.equal(hidden.technologies, null);
    assert.deepEqual(hidden.assets.map((row) => row.id), [seed.assets.alpha.id, seed.assets.mid.id], 'linked assets stay listed');
    assert.deepEqual(hidden.suggestions.map((row) => row.name), ['Cedar app', 'Delta app']);

    // A Business Contributor sees the applications they take part in.
    const scoped = await http.relations(seed.contractId, req(runner, seed, READ, seed.userId));
    assert.deepEqual(
      scoped.suggestions.filter((row) => row.type === 'application').map((row) => row.id),
      [seed.apps.suggested.id],
    );
    assert.ok(scoped.suggestions.some((row) => row.id === seed.assets.suggested.id), 'assets are not scoped by application participation');

    // The same supplier, before the supplier is cleared.
    const bare = await http.relations(seed.bareContractId, req(runner, seed, READ));
    assert.ok(bare.suggestions.some((row) => row.id === seed.apps.suggested.id));

    // `supplier_id` is NOT NULL. The rolled-back transaction drops that so the guard can run.
    await runner.query(`ALTER TABLE contracts ALTER COLUMN supplier_id DROP NOT NULL`);
    await runner.query(`UPDATE contracts SET supplier_id = NULL WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.bareContractId]);
    const none = await http.relations(seed.bareContractId, req(runner, seed, READ));
    assert.deepEqual(none.suggestions, []);
  });
}

async function testSuggestionCap() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'ctab-cap');
    const supplierId = (await runner.query(
      `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Cap supplier') RETURNING id`,
      [seed.tenantId],
    ))[0].id as string;
    const companyId = (await runner.query(`SELECT company_id FROM contracts WHERE id = $1`, [seed.contractId]))[0].company_id as string;
    const contractId = (await runner.query(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, 'Cap contract', $2, $3, DATE '2026-01-01') RETURNING id`,
      [seed.tenantId, companyId, supplierId],
    ))[0].id as string;
    for (let n = 1; n <= 21; n += 1) {
      await runner.query(
        `INSERT INTO applications (tenant_id, name, supplier_id) VALUES ($1, $2, $3)`,
        [seed.tenantId, `Cap ${String(n).padStart(2, '0')}`, supplierId],
      );
    }
    for (let n = 1; n <= 21; n += 1) {
      const assetId = (await runner.query(
        `INSERT INTO assets (tenant_id, name, kind, environment, status, created_at, updated_at)
         VALUES ($1, $2, 'physical_server', 'prod', 'active', now(), now()) RETURNING id`,
        [seed.tenantId, `Box ${String(n).padStart(2, '0')}`],
      ))[0].id as string;
      await runner.query(
        `INSERT INTO asset_support_info (tenant_id, asset_id, vendor_id) VALUES ($1, $2, $3)`,
        [seed.tenantId, assetId, supplierId],
      );
    }
    const { controller: http } = controller();
    const res = await http.relations(contractId, req(runner, seed, READ));
    const applications = res.suggestions.filter((row) => row.type === 'application').map((row) => row.name);
    const assets = res.suggestions.filter((row) => row.type === 'asset').map((row) => row.name);
    assert.deepEqual(applications, Array.from({ length: 20 }, (_, i) => `Cap ${String(i + 1).padStart(2, '0')}`));
    assert.deepEqual(assets, Array.from({ length: 20 }, (_, i) => `Box ${String(i + 1).padStart(2, '0')}`));
  });
}

async function testLinksAndAudit() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'ctab-audit');
    const { audit, svc, controller: http } = controller();
    const opts = { manager: runner.manager };
    const writer = req(runner, seed, WRITE, seed.userId);
    const linked = [seed.apps.alpha.id, seed.apps.mid.id].sort();

    assert.deepEqual(
      await http.linkRelation(seed.contractId, 'applications', { id: seed.apps.alpha.id }, writer),
      { ok: true, changed: false },
    );
    assert.equal(audit.entries.length, 0, 'linking what is linked writes no audit row');

    assert.deepEqual(
      await http.linkRelation(seed.contractId, 'applications', { id: ` ${seed.apps.suggested.id.toUpperCase()} ` }, writer),
      { ok: true, changed: true },
    );
    const withCedar = [...linked, seed.apps.suggested.id].sort();
    assert.deepEqual(audit.entries[0], {
      table: 'application_contracts', recordId: seed.contractId, action: 'update',
      before: { ids: linked }, after: { ids: withCedar }, userId: seed.userId,
    });
    assert.deepEqual(
      await http.linkRelation(seed.contractId, 'applications', { id: seed.apps.suggested.id }, writer),
      { ok: true, changed: false },
    );
    assert.equal(audit.entries.length, 1);

    assert.deepEqual(
      await http.unlinkRelation(seed.contractId, 'applications', seed.apps.suggested.id, writer),
      { ok: true, changed: true },
    );
    assert.deepEqual(audit.entries[1].before, { ids: withCedar });
    assert.deepEqual(audit.entries[1].after, { ids: linked });
    assert.deepEqual(
      await http.unlinkRelation(seed.contractId, 'applications', seed.apps.outOfScope.id, writer),
      { ok: true, changed: false },
    );
    assert.equal(audit.entries.length, 2, 'unlinking what is not linked writes no audit row');

    // The bulk replacement writes the same shape on the same table, for the same contract.
    const assetIds = [seed.assets.alpha.id, seed.assets.mid.id].sort();
    await svc.replaceRelations(seed.contractId, 'assets', [seed.assets.alpha.id], seed.userId, opts);
    assert.deepEqual(audit.entries[2], {
      table: 'asset_contracts', recordId: seed.contractId, action: 'update',
      before: { ids: assetIds }, after: { ids: [seed.assets.alpha.id] }, userId: seed.userId,
    });
    assert.deepEqual(
      await http.linkRelation(seed.contractId, 'assets', { id: seed.assets.suggested.id }, writer),
      { ok: true, changed: true },
    );
    assert.equal(audit.entries[3].table, 'asset_contracts');
    assert.deepEqual(audit.entries[3].before, { ids: [seed.assets.alpha.id] });
    assert.deepEqual(audit.entries[3].after, { ids: [seed.assets.alpha.id, seed.assets.suggested.id].sort() });

    const techIds = [seed.techs.alpha.id, seed.techs.mid.id].sort();
    assert.deepEqual(
      await http.unlinkRelation(seed.contractId, 'technologies', seed.techs.mid.id, writer),
      { ok: true, changed: true },
    );
    assert.deepEqual(audit.entries[4], {
      table: 'technology_contracts', recordId: seed.contractId, action: 'update',
      before: { ids: techIds }, after: { ids: [seed.techs.alpha.id] }, userId: seed.userId,
    });

    const counts = await svc.relationCounts(seed.contractId, { ...opts, technologies: true });
    assert.equal(counts.applications, 2);
    assert.equal(counts.assets, 2);
    assert.equal(counts.technologies, 1);
    assert.deepEqual((await svc.listApplications(seed.contractId, opts)).items.map((row) => row.id), [seed.apps.alpha.id, seed.apps.mid.id]);
  });
}

async function testRefusals() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'ctab-refuse');
    const { audit, svc, controller: http } = controller();
    const writer = req(runner, seed, WRITE, seed.userId);
    const noInfra = req(runner, seed, { contracts: 'member' }, seed.userId);

    const invalid = await rejection(() => http.linkRelation(seed.contractId, 'applications', { id: 'nope' }, writer));
    assert.ok(invalid instanceof BadRequestException);
    assert.equal(invalid.message, 'Invalid id.');

    for (const [kind, message] of [
      ['applications', 'One or more applications not found.'],
      ['assets', 'One or more assets not found.'],
      ['technologies', 'One or more technologies not found.'],
    ] as const) {
      const err = await rejection(() => http.linkRelation(seed.contractId, kind, { id: randomUUID() }, writer));
      assert.ok(err instanceof BadRequestException, kind);
      assert.equal(err.message, message);
    }

    const unknown = await rejection(() => http.linkRelation(seed.contractId, 'budget_lines', { id: seed.apps.alpha.id }, writer));
    assert.ok(unknown instanceof NotFoundException);
    assert.equal(unknown.message, 'Unknown relation type.');

    const refused = await rejection(() => http.unlinkRelation(seed.contractId, 'technologies', seed.techs.alpha.id, noInfra));
    assert.ok(refused instanceof ForbiddenException);
    assert.equal(refused.message, 'You cannot read technologies.');
    const refusedLink = await rejection(() => http.linkRelation(seed.contractId, 'technologies', { id: randomUUID() }, noInfra));
    assert.ok(refusedLink instanceof ForbiddenException);

    assert.equal(audit.entries.length, 0);
    assert.equal((await svc.listTechnologies(seed.contractId, { manager: runner.manager })).items.length, 2, 'nothing removed');
  });
}

async function testTenantIsolation() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seedTab(runner, 'ctab-a');
    const b = await seedTab(runner, 'ctab-b');
    await setTenant(runner, b.tenantId);
    const { controller: http } = controller();
    const reader = req(runner, b, READ);
    const writer = req(runner, b, WRITE, b.userId);

    for (const call of [
      () => http.relations(a.contractId, reader),
      () => http.linkRelation(a.contractId, 'applications', { id: b.apps.suggested.id }, writer),
      () => http.unlinkRelation(a.contractId, 'assets', a.assets.alpha.id, writer),
    ]) {
      assert.ok((await rejection(call)) instanceof NotFoundException);
    }

    const err = await rejection(() => http.linkRelation(b.contractId, 'applications', { id: a.apps.suggested.id }, writer));
    assert.ok(err instanceof BadRequestException);
    assert.equal(err.message, 'One or more applications not found.');
    const own = await http.relations(b.contractId, reader);
    assert.deepEqual(own.applications.map((row) => row.id), [b.apps.alpha.id, b.apps.mid.id]);
    assert.ok(!own.suggestions.some((row) => row.id === a.apps.suggested.id));

    await setTenant(runner, a.tenantId);
    const back = await http.relations(a.contractId, req(runner, a, READ));
    assert.deepEqual(back.applications.map((row) => row.id), [a.apps.alpha.id, a.apps.mid.id]);
  });
}

void runSpecs('contract-relations-tab.integration.spec', [
  ['testPayload', testPayload],
  ['testSuggestions', testSuggestions],
  ['testSuggestionCap', testSuggestionCap],
  ['testLinksAndAudit', testLinksAndAudit],
  ['testRefusals', testRefusals],
  ['testTenantIsolation', testTenantIsolation],
]);

void dataSource;
