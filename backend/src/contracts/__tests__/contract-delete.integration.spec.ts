import 'dotenv/config';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { ContractsDeleteService } from '../contracts-delete.service';
import { assert, captureAudit, CAPEX_NUMBER_OFFSET, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';

// Deleting a contract (`contracts-delete.service.ts`), against a real database:
// - the links go, the linked objects stay: budget lines of both natures (link rows and the
//   line's own `contract_id`), applications, assets (links and support contract), contacts;
// - what belongs to the contract goes with it: its website links, attachments (rows, then the
//   files no other attachment row uses) and its tasks (the renewal task too, and the rows of the
//   former `contract_tasks` table), as a budget line deletes its tasks;
// - a contract with recorded compliance requirements is refused (409, code and count);
// - the counts the confirmation shows, for one contract or several, refused ones apart;
// - a bulk delete reports each contract it could not delete (another tenant's, a malformed id,
//   one with recorded requirements) and deletes the others; another contract keeps everything;
// - a contract of another tenant is not found and nothing is removed.

type Seed = {
  tenantId: string;
  contractId: string;
  otherContractId: string;
  opexId: string;
  capexId: string;
  appId: string;
  assetId: string;
  supportedAssetId: string;
  contactId: string;
  taskId: string;
  attachmentPath: string;
};

async function seed(runner: QueryRunner, tag: string): Promise<Seed> {
  const tenantId = await seedTenant(runner, tag);
  await setTenant(runner, tenantId);
  const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;
  const companyId = await one(
    `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, $2, 'FR', 'Lyon') RETURNING id`,
    [tenantId, `Delete company ${tag}`],
  );
  const supplierId = await one(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, `Delete supplier ${tag}`]);
  const contract = (name: string) => one(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, $2, $3, $4, DATE '2026-01-01') RETURNING id`,
    [tenantId, name, companyId, supplierId],
  );
  const contractId = await contract(`Delete contract ${tag}`);
  const otherContractId = await contract(`Kept contract ${tag}`);
  const opexId = await one(
    `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, paying_company_id, contract_id)
     VALUES ($1, $2, 'EUR', '2026-01-01', 7, $3, $4) RETURNING id`,
    [tenantId, `Delete OPEX ${tag}`, companyId, contractId],
  );
  const capexId = await one(
    `INSERT INTO spend_items (tenant_id, nature, product_name, ppe_type, investment_type, priority, currency, effective_start, item_number, legacy_number)
     VALUES ($1, 'capex', $2, 'hardware', 'replacement', 'medium', 'EUR', '2026-01-01', $3, 'CPX-1') RETURNING id`,
    [tenantId, `Delete CAPEX ${tag}`, CAPEX_NUMBER_OFFSET + 1],
  );
  const appId = await one(`INSERT INTO applications (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, `Delete app ${tag}`]);
  const asset = (name: string) => one(
    `INSERT INTO assets (tenant_id, name, kind, provider, environment, status, created_at, updated_at)
     VALUES ($1, $2, 'physical_server', 'on_premise', 'prod', 'active', now(), now()) RETURNING id`,
    [tenantId, name],
  );
  const assetId = await asset(`delete-srv-${tag}`);
  const supportedAssetId = await asset(`delete-supported-${tag}`);
  const contactId = await one(
    `INSERT INTO contacts (tenant_id, email, first_name, last_name) VALUES ($1, $2, 'Ana', 'Delete') RETURNING id`,
    [tenantId, `ana.${tag}@example.com`],
  );
  const taskId = await one(
    `INSERT INTO tasks (tenant_id, item_number, title, related_object_type, related_object_id) VALUES ($1, 1, 'Decide the renewal', 'contract', $2) RETURNING id`,
    [tenantId, contractId],
  );
  const attachmentPath = `files/${tenantId}/contracts/${contractId}/2026/01/${tag}.pdf`;

  // The same links on both contracts: the kept one must keep all of them.
  for (const id of [contractId, otherContractId]) {
    for (const line of [opexId, capexId]) {
      await runner.query(`INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES ($1, $2, $3)`, [tenantId, id, line]);
    }
    await runner.query(`INSERT INTO application_contracts (tenant_id, application_id, contract_id) VALUES ($1, $2, $3)`, [tenantId, appId, id]);
    await runner.query(`INSERT INTO asset_contracts (tenant_id, asset_id, contract_id) VALUES ($1, $2, $3)`, [tenantId, assetId, id]);
    await runner.query(
      `INSERT INTO contract_contacts (tenant_id, contract_id, contact_id, role, origin) VALUES ($1, $2, $3, 'commercial', 'manual')`,
      [tenantId, id, contactId],
    );
    await runner.query(`INSERT INTO contract_links (tenant_id, contract_id, url) VALUES ($1, $2, 'https://portal.example.com')`, [tenantId, id]);
    await runner.query(`INSERT INTO contract_tasks (tenant_id, contract_id, description) VALUES ($1, $2, 'Former task')`, [tenantId, id]);
  }
  await runner.query(
    `INSERT INTO contract_attachments (tenant_id, contract_id, original_filename, stored_filename, size, storage_path)
     VALUES ($1, $2, 'contract.pdf', 'contract.pdf', 10, $3)`,
    [tenantId, contractId, attachmentPath],
  );
  await runner.query(
    `INSERT INTO contract_attachments (tenant_id, contract_id, original_filename, stored_filename, size, storage_path)
     VALUES ($1, $2, 'kept.pdf', 'kept.pdf', 10, $3)`,
    [tenantId, otherContractId, `${attachmentPath}.kept`],
  );
  await runner.query(
    `INSERT INTO asset_support_info (tenant_id, asset_id, support_contract_id) VALUES ($1, $2, $3)`,
    [tenantId, supportedAssetId, contractId],
  );
  return { tenantId, contractId, otherContractId, opexId, capexId, appId, assetId, supportedAssetId, contactId, taskId, attachmentPath };
}

function captureStorage() {
  const deleted: string[] = [];
  return { deleted, deleteObject: async (path: string) => { deleted.push(path); } };
}

function service(audit = captureAudit(), storage = captureStorage()): ContractsDeleteService {
  const timeAggregates = { recalculateUserMonth: async () => undefined };
  return new ContractsDeleteService({ manager: null } as any, storage as any, audit as any, timeAggregates as any);
}

/** Records compliance requirements on a contract: a state, a reference alone, "not applicable". */
async function recordRequirements(runner: QueryRunner, tenantId: string, contractId: string) {
  await runner.query(
    `INSERT INTO contract_compliance_items (tenant_id, contract_id, requirement, state, reference)
     VALUES ($1, $2, 'gdpr_dpa', 'present', NULL), ($1, $2, 'exit_plan', NULL, 'Annex 4'), ($1, $2, 'reversibility', 'not_applicable', NULL)`,
    [tenantId, contractId],
  );
}

/** Rows of each link table that name `contractId`. */
async function linkRows(runner: QueryRunner, tenantId: string, contractId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of ['contract_spend_items', 'application_contracts', 'asset_contracts', 'contract_contacts', 'contract_links', 'contract_attachments', 'contract_compliance_items', 'contract_tasks']) {
    const [row] = await runner.query(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1 AND contract_id = $2`, [tenantId, contractId]);
    counts[table] = row.n;
  }
  const [support] = await runner.query(`SELECT count(*)::int AS n FROM asset_support_info WHERE tenant_id = $1 AND support_contract_id = $2`, [tenantId, contractId]);
  counts.asset_support_info = support.n;
  const [lines] = await runner.query(`SELECT count(*)::int AS n FROM spend_items WHERE tenant_id = $1 AND contract_id = $2 AND nature IN ('opex', 'capex')`, [tenantId, contractId]);
  counts.spend_items = lines.n;
  const [tasks] = await runner.query(`SELECT count(*)::int AS n FROM tasks WHERE tenant_id = $1 AND related_object_type = 'contract' AND related_object_id = $2`, [tenantId, contractId]);
  counts.tasks = tasks.n;
  return counts;
}

async function exists(runner: QueryRunner, table: string, id: string): Promise<boolean> {
  return (await runner.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id])).length === 1;
}

async function testImpactCounts() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seed(runner, 'ctdel-impact');
    const svc = service();
    const opts = { manager: runner.manager };

    assert.deepEqual(await svc.deleteImpact([a.contractId], opts), {
      contracts: 1,
      budget_lines: 2,
      applications: 1,
      assets: 2,
      contacts: 1,
      tasks: 1,
      links: 1,
      attachments: 1,
      blocked: 0,
      recorded_requirements: 0,
    });
    // Several contracts: each linked object once, what belongs to a contract per contract.
    assert.deepEqual(await svc.deleteImpact([a.contractId, a.otherContractId, 'not-a-uuid'], opts), {
      contracts: 2,
      budget_lines: 2,
      applications: 1,
      assets: 2,
      contacts: 1,
      tasks: 1,
      links: 2,
      attachments: 2,
      blocked: 0,
      recorded_requirements: 0,
    });
    // A contract with recorded requirements is refused: counted apart, its links not counted.
    await recordRequirements(runner, a.tenantId, a.contractId);
    assert.deepEqual(await svc.deleteImpact([a.contractId, a.otherContractId], opts), {
      contracts: 1,
      budget_lines: 2,
      applications: 1,
      assets: 1,
      contacts: 1,
      tasks: 0,
      links: 1,
      attachments: 1,
      blocked: 1,
      recorded_requirements: 3,
    });
  });
}

async function testDeleteDetachesEverything() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seed(runner, 'ctdel-one');
    const audit = captureAudit();
    const storage = captureStorage();
    const svc = service(audit, storage);
    const keptBefore = await linkRows(runner, a.tenantId, a.otherContractId);
    const searchBefore = await runner.query(`SELECT 1 FROM search_index WHERE tenant_id = $1 AND entity_id = $2`, [a.tenantId, a.contractId]);
    assert.equal(searchBefore.length, 1, 'the search finds the contract before');

    await svc.delete(a.contractId, { manager: runner.manager, userId: null });

    assert.equal(await exists(runner, 'contracts', a.contractId), false, 'the contract is gone');
    const left = await linkRows(runner, a.tenantId, a.contractId);
    for (const [table, n] of Object.entries(left)) assert.equal(n, 0, `${table} still names the deleted contract`);
    // The linked objects stay.
    for (const [table, id] of [
      ['spend_items', a.opexId], ['spend_items', a.capexId], ['applications', a.appId], ['assets', a.assetId],
      ['assets', a.supportedAssetId], ['contacts', a.contactId],
    ] as const) {
      assert.equal(await exists(runner, table, id), true, `${table} ${id} stays`);
    }
    assert.equal(await exists(runner, 'tasks', a.taskId), false, 'the contract\'s task goes with it');
    const [support] = await runner.query(`SELECT support_contract_id FROM asset_support_info WHERE tenant_id = $1 AND asset_id = $2`, [a.tenantId, a.supportedAssetId]);
    assert.equal(support.support_contract_id, null, 'the asset keeps its support details');
    // The search no longer finds it.
    const found = await runner.query(`SELECT 1 FROM search_index WHERE tenant_id = $1 AND entity_id = $2`, [a.tenantId, a.contractId]);
    assert.equal(found.length, 0, 'no search entry left');
    // The other contract keeps everything.
    assert.deepEqual(await linkRows(runner, a.tenantId, a.otherContractId), keptBefore);
    // One audit row for the contract (the task's activity goes with the task).
    assert.deepEqual(
      audit.entries.filter((e) => e.table === 'contracts').map((e) => [e.action, e.recordId, e.before?.name]),
      [['delete', a.contractId, 'Delete contract ctdel-one']],
    );
    // The attachment's file, which no other attachment row uses, is deleted; the other contract's file stays.
    const sharing = await runner.query(`SELECT 1 FROM contract_attachments WHERE tenant_id = $1 AND storage_path = $2`, [a.tenantId, a.attachmentPath]);
    assert.equal(sharing.length, 0, 'no row uses the file any more');
    assert.deepEqual(storage.deleted, [a.attachmentPath]);
  });
}

async function testBulkDelete() {
  await inRolledBackTransaction(async (runner) => {
    const other = await seed(runner, 'ctdel-bulk-other');
    const a = await seed(runner, 'ctdel-bulk');
    // Another attachment row of the tenant uses the same file: the file stays.
    await runner.query(
      `INSERT INTO contract_attachments (tenant_id, contract_id, original_filename, stored_filename, size, storage_path)
       VALUES ($1, $2, 'copy.pdf', 'copy.pdf', 10, $3)`,
      [a.tenantId, a.otherContractId, a.attachmentPath],
    );
    // A third contract with recorded requirements is refused, with its code and count.
    const blockedId = (await runner.query(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date)
       SELECT tenant_id, 'Audited contract', company_id, supplier_id, start_date FROM contracts WHERE id = $1 RETURNING id`,
      [a.contractId],
    ))[0].id as string;
    await recordRequirements(runner, a.tenantId, blockedId);
    const audit = captureAudit();
    const storage = captureStorage();
    const svc = service(audit, storage);

    const result = await svc.bulkDelete([a.contractId, other.contractId, 'not-a-uuid', blockedId, a.otherContractId], null, { manager: runner.manager });

    assert.deepEqual(result.deleted, [a.contractId, a.otherContractId]);
    assert.deepEqual(result.failed.map((f) => f.id), [other.contractId, 'not-a-uuid', blockedId]);
    assert.ok(result.failed.slice(0, 2).every((f) => f.reason === 'Contract not found.'), JSON.stringify(result.failed));
    assert.deepEqual(
      { name: result.failed[2].name, code: result.failed[2].code, count: result.failed[2].count },
      { name: 'Audited contract', code: 'CONTRACT_HAS_COMPLIANCE_RECORDS', count: 3 },
    );
    assert.equal(await exists(runner, 'contracts', blockedId), true);
    assert.equal(await exists(runner, 'contracts', a.contractId), false);
    assert.equal(await exists(runner, 'contracts', a.otherContractId), false);
    assert.equal(await exists(runner, 'applications', a.appId), true);
    assert.deepEqual(audit.entries.map((e) => e.recordId), [a.contractId, a.otherContractId]);
    // Both contracts gone: no row uses either file any more.
    assert.deepEqual(storage.deleted.sort(), [a.attachmentPath, `${a.attachmentPath}.kept`].sort());

    // The other tenant's contract is untouched.
    await setTenant(runner, other.tenantId);
    assert.equal(await exists(runner, 'contracts', other.contractId), true);
    assert.equal((await linkRows(runner, other.tenantId, other.contractId)).contract_spend_items, 2);
  });
}

async function testSharedFileStays() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seed(runner, 'ctdel-shared');
    await runner.query(
      `INSERT INTO contract_attachments (tenant_id, contract_id, original_filename, stored_filename, size, storage_path)
       VALUES ($1, $2, 'copy.pdf', 'copy.pdf', 10, $3)`,
      [a.tenantId, a.otherContractId, a.attachmentPath],
    );
    const storage = captureStorage();
    await service(captureAudit(), storage).delete(a.contractId, { manager: runner.manager });
    assert.deepEqual(storage.deleted, [], 'a file another attachment uses stays');
  });
}

async function testRecordedRequirementsRefused() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seed(runner, 'ctdel-audited');
    await recordRequirements(runner, a.tenantId, a.contractId);
    const before = await linkRows(runner, a.tenantId, a.contractId);
    const storage = captureStorage();
    const svc = service(captureAudit(), storage);

    let refusal: unknown = null;
    try {
      await svc.delete(a.contractId, { manager: runner.manager });
    } catch (err) {
      refusal = err;
    }
    assert.ok(refusal instanceof ConflictException, `a 409, got ${String(refusal)}`);
    const body = (refusal as ConflictException).getResponse() as Record<string, unknown>;
    assert.equal(body.code, 'CONTRACT_HAS_COMPLIANCE_RECORDS');
    assert.equal(body.count, 3);
    assert.match(String(body.message), /3 recorded compliance requirements/);
    // Nothing moved.
    assert.equal(await exists(runner, 'contracts', a.contractId), true);
    assert.equal(await exists(runner, 'tasks', a.taskId), true);
    assert.deepEqual(await linkRows(runner, a.tenantId, a.contractId), before);
    assert.deepEqual(storage.deleted, []);
  });
}

async function testOtherTenantNotFound() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seed(runner, 'ctdel-a');
    const b = await seed(runner, 'ctdel-b');
    await setTenant(runner, b.tenantId);
    const svc = service();

    await assert.rejects(() => svc.delete(a.contractId, { manager: runner.manager }), NotFoundException);
    assert.equal((await svc.deleteImpact([a.contractId], { manager: runner.manager })).contracts, 0);

    await setTenant(runner, a.tenantId);
    assert.equal(await exists(runner, 'contracts', a.contractId), true);
    assert.equal((await linkRows(runner, a.tenantId, a.contractId)).contract_spend_items, 2);
  });
}

void runSpecs('contract-delete', [
  ['impact counts', testImpactCounts],
  ['delete detaches every kind and keeps the linked objects', testDeleteDetachesEverything],
  ['bulk delete', testBulkDelete],
  ['a file another attachment uses stays', testSharedFileStays],
  ['recorded compliance requirements refuse the delete', testRecordedRequirementsRefused],
  ['another tenant is not found', testOtherTenantNotFound],
]);
