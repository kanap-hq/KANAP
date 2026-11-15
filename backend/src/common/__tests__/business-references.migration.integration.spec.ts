import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { BusinessReferences1856240000000 } from '../../migrations/1856240000000-business-references';

// Business references of the suppliers, companies, contacts, departments and contracts (migration
// 1856240000000), against a real database, each test in one transaction rolled back at the end:
// - from the state before the migration (its down()), on a dirty database (a partial earlier run:
//   a number held twice, a hole, a number below 1, a counter behind), the migration repairs,
//   numbers the rest in (created_at, id) order per tenant, sets the counters, indexes SUP-n in the
//   search index of its own tenant only, puts back RLS, the search triggers and app.current_tenant,
//   and a rerun changes nothing and says so;
// - rows created at the same time are numbered by name (a supplier by its ERP ID first), not by uuid;
// - the trigger numbers any insert, keeps a number given and moves the counter past it.
// @database-spec

const TABLES = ['suppliers', 'companies', 'contacts', 'departments', 'contracts'] as const;

async function inRollback(fn: (runner: QueryRunner) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await fn(runner);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function seedTenant(runner: QueryRunner, tag: string) {
  const tenantId = randomUUID();
  const slug = `${tag}-${tenantId.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Business references', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug],
  );
  return { tenantId, slug };
}

async function asTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function insert(runner: QueryRunner, table: string, tenantId: string, values: Record<string, unknown>): Promise<string> {
  await asTenant(runner, tenantId);
  const columns = ['tenant_id', ...Object.keys(values)];
  const params = [tenantId, ...Object.values(values)];
  const [row] = await runner.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${params.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id::text AS id`,
    params,
  );
  return row.id;
}

/** One row of each family, created at `at`; the departments and contracts hang on `company` and `supplier`. */
async function seedFamilies(runner: QueryRunner, tenantId: string, tag: string, at: string, links: { company: string; supplier: string }) {
  return {
    suppliers: await insert(runner, 'suppliers', tenantId, { name: `Supplier ${tag}`, created_at: at }),
    companies: await insert(runner, 'companies', tenantId, { name: `Company ${tag}`, country_iso: 'FR', city: 'Lyon', created_at: at }),
    contacts: await insert(runner, 'contacts', tenantId, { email: `${tag.toLowerCase()}@example.test`, created_at: at }),
    departments: await insert(runner, 'departments', tenantId, { name: `Department ${tag}`, company_id: links.company, created_at: at }),
    contracts: await insert(runner, 'contracts', tenantId, {
      name: `Contract ${tag}`, company_id: links.company, supplier_id: links.supplier, start_date: '2026-01-01', created_at: at,
    }),
  };
}

async function numbersOf(runner: QueryRunner, table: string, tenantId: string): Promise<Record<string, number>> {
  await asTenant(runner, tenantId);
  const rows: Array<{ id: string; n: number }> = await runner.query(
    `SELECT id::text AS id, item_number AS n FROM ${table} WHERE tenant_id = $1`,
    [tenantId],
  );
  return Object.fromEntries(rows.map((row) => [row.id, row.n]));
}

async function counter(runner: QueryRunner, tenantId: string, type: string): Promise<number | null> {
  await asTenant(runner, tenantId);
  const [row] = await runner.query(
    `SELECT next_val::int AS n FROM item_sequences WHERE tenant_id = $1 AND entity_type = $2`,
    [tenantId, type],
  );
  return row?.n ?? null;
}

async function rlsStates(runner: QueryRunner) {
  return runner.query(
    `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relrowsecurity ORDER BY relname`,
  );
}

async function searchTriggers(runner: QueryRunner) {
  return runner.query(
    `SELECT c.relname, t.tgname, t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relname = ANY($1) AND t.tgname LIKE 'trg_search_index_%' ORDER BY 1, 2`,
    [TABLES],
  );
}

async function logged(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

/** The entities found in the search index of the current tenant for the words of `text`. */
async function search(runner: QueryRunner, tenantId: string, entityType: string, text: string): Promise<string[]> {
  await asTenant(runner, tenantId);
  const rows: Array<{ id: string }> = await runner.query(
    `SELECT entity_id::text AS id FROM search_index
      WHERE entity_type = $1 AND search_vector @@ plainto_tsquery('kanap_en', $2) ORDER BY 1`,
    [entityType, text],
  );
  return rows.map((row) => row.id);
}

async function testMigrationRepairsAndNumbers() {
  await inRollback(async (runner) => {
    const migration = new BusinessReferences1856240000000();
    await logged(() => migration.down(runner));
    const rlsBefore = await rlsStates(runner);
    const triggersBefore = await searchTriggers(runner);
    const a = await seedTenant(runner, 'bref-a');
    const b = await seedTenant(runner, 'bref-b');

    // Tenant A: five rows of each family, inserted out of their creation order.
    const companyA = await insert(runner, 'companies', a.tenantId, { name: 'Base A', country_iso: 'FR', city: 'Lyon', created_at: '2025-06-01T00:00:00Z' });
    const supplierA = await insert(runner, 'suppliers', a.tenantId, { name: 'Base supplier A', created_at: '2025-06-01T00:00:00Z' });
    const linksA = { company: companyA, supplier: supplierA };
    const a3 = await seedFamilies(runner, a.tenantId, 'A3', '2026-03-01T00:00:00Z', linksA);
    const a1 = await seedFamilies(runner, a.tenantId, 'A1', '2026-01-01T00:00:00Z', linksA);
    const a2 = await seedFamilies(runner, a.tenantId, 'A2', '2026-02-01T00:00:00Z', linksA);
    const a0 = await seedFamilies(runner, a.tenantId, 'A0', '2025-12-01T00:00:00Z', linksA);

    // Tenant B: two suppliers only, and one row of the other families.
    const companyB = await insert(runner, 'companies', b.tenantId, { name: 'Base B', country_iso: 'FR', city: 'Lyon', created_at: '2026-01-01T00:00:00Z' });
    const supplierB = await insert(runner, 'suppliers', b.tenantId, { name: 'Base supplier B', created_at: '2026-01-01T00:00:00Z' });
    const b1 = await seedFamilies(runner, b.tenantId, 'B1', '2026-02-01T00:00:00Z', { company: companyB, supplier: supplierB });

    // A partial earlier run on A's suppliers: the base supplier and A3 both hold 1, A2 holds 3
    // (2 is a hole), A0 holds 0, and the counter says 2 (behind).
    await runner.query(`ALTER TABLE suppliers ADD COLUMN item_number integer`);
    await asTenant(runner, a.tenantId);
    await runner.query(`UPDATE suppliers SET item_number = 1 WHERE id = ANY($1::uuid[])`, [[supplierA, a3.suppliers]]);
    await runner.query(`UPDATE suppliers SET item_number = 3 WHERE id = $1`, [a2.suppliers]);
    await runner.query(`UPDATE suppliers SET item_number = 0 WHERE id = $1`, [a0.suppliers]);
    await runner.query(`ALTER TABLE item_sequences DROP CONSTRAINT item_sequences_entity_type_check`);
    await runner.query(`INSERT INTO item_sequences (tenant_id, entity_type, next_val) VALUES ($1, 'supplier', 2)`, [a.tenantId]);
    // A counter ahead (numbers taken by rows deleted since) is never moved back.
    await asTenant(runner, b.tenantId);
    await runner.query(`INSERT INTO item_sequences (tenant_id, entity_type, next_val) VALUES ($1, 'company', 40)`, [b.tenantId]);
    await runner.query(`SELECT set_config('app.current_tenant', '', true)`);

    const log = await logged(() => migration.up(runner));
    const [{ tenant }] = await runner.query(`SELECT current_setting('app.current_tenant', true) AS tenant`);
    assert.equal(tenant, '', 'app.current_tenant is put back as found');

    // Suppliers of A: the base supplier (earliest) keeps 1, A2 keeps 3; A3 (later holder of 1) and
    // A0 (0) lose theirs; the rows without a number follow 3 in (created_at, id) order: A0, A1, A3.
    assert.deepEqual(await numbersOf(runner, 'suppliers', a.tenantId), {
      [supplierA]: 1, [a2.suppliers]: 3, [a0.suppliers]: 4, [a1.suppliers]: 5, [a3.suppliers]: 6,
    });
    assert.equal(await counter(runner, a.tenantId, 'supplier'), 7);
    // The other families of A: numbered from 1 in creation order.
    assert.deepEqual(await numbersOf(runner, 'companies', a.tenantId), {
      [companyA]: 1, [a0.companies]: 2, [a1.companies]: 3, [a2.companies]: 4, [a3.companies]: 5,
    });
    for (const table of ['contacts', 'departments', 'contracts'] as const) {
      assert.deepEqual(await numbersOf(runner, table, a.tenantId), {
        [a0[table]]: 1, [a1[table]]: 2, [a2[table]]: 3, [a3[table]]: 4,
      }, table);
    }
    assert.equal(await counter(runner, a.tenantId, 'company'), 6);
    assert.equal(await counter(runner, a.tenantId, 'contact'), 5);
    assert.equal(await counter(runner, a.tenantId, 'department'), 5);
    assert.equal(await counter(runner, a.tenantId, 'contract'), 5);
    // Tenant B: its own numbers; its company counter ahead moves the new numbers past it, never back.
    assert.deepEqual(await numbersOf(runner, 'suppliers', b.tenantId), { [supplierB]: 1, [b1.suppliers]: 2 });
    assert.deepEqual(await numbersOf(runner, 'companies', b.tenantId), { [companyB]: 40, [b1.companies]: 41 });
    assert.equal(await counter(runner, b.tenantId, 'company'), 42);
    assert.equal(await counter(runner, b.tenantId, 'contract'), 2);

    assert.match(log, /suppliers: \d+ row\(s\) numbered in \d+ tenant\(s\), 2 repaired/);
    assert.match(log, /contracts: \d+ row\(s\) numbered in \d+ tenant\(s\), 0 repaired/);
    assert.deepEqual(await rlsStates(runner), rlsBefore, 'RLS is put back as found');
    assert.deepEqual(await searchTriggers(runner), triggersBefore, 'the search index triggers are enabled again');
    for (const table of TABLES) {
      const [column] = await runner.query(
        `SELECT is_nullable FROM information_schema.columns WHERE table_name = $1 AND column_name = 'item_number'`,
        [table],
      );
      assert.equal(column.is_nullable, 'NO', `${table}.item_number is NOT NULL`);
      const [index] = await runner.query(`SELECT indexdef FROM pg_indexes WHERE indexname = $1`, [`uq_${table}_tenant_item_number`]);
      assert.match(String(index?.indexdef), /UNIQUE INDEX .* \(tenant_id, item_number\)/, table);
    }

    // The search index: SUP-6 finds A3 in A, and nothing in B (which has two suppliers).
    assert.deepEqual(await search(runner, a.tenantId, 'suppliers', 'SUP-6'), [a3.suppliers]);
    assert.deepEqual(await search(runner, b.tenantId, 'suppliers', 'SUP-6'), []);
    await asTenant(runner, a.tenantId);
    const indexed = await runner.query(
      `SELECT entity_type, ref_prefix, ref_number FROM search_index WHERE tenant_id = $1 AND entity_id = ANY($2::uuid[]) ORDER BY entity_type`,
      [a.tenantId, Object.values(a1)],
    );
    assert.deepEqual(indexed, [
      { entity_type: 'companies', ref_prefix: 'COMP', ref_number: 3 },
      { entity_type: 'contacts', ref_prefix: 'CTCT', ref_number: 2 },
      { entity_type: 'contracts', ref_prefix: 'CTR', ref_number: 2 },
      { entity_type: 'departments', ref_prefix: 'DEPT', ref_number: 2 },
      { entity_type: 'suppliers', ref_prefix: 'SUP', ref_number: 5 },
    ]);
    assert.deepEqual(await search(runner, a.tenantId, 'contacts', 'CTCT-2'), [a1.contacts]);
    assert.deepEqual(await search(runner, a.tenantId, 'departments', 'DEPT-3'), [a2.departments]);

    const before = await Promise.all(TABLES.map((table) => numbersOf(runner, table, a.tenantId)));
    await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
    const rerun = await logged(() => migration.up(runner));
    for (const table of TABLES) assert.match(rerun, new RegExp(`${table}: nothing to number .*0 index refresh`), table);
    assert.deepEqual(await Promise.all(TABLES.map((table) => numbersOf(runner, table, a.tenantId))), before, 'a rerun changes nothing');

  });
}

/** Rows created in one transaction share `created_at`: the name (and a supplier's ERP ID first) orders them, never the uuid. */
async function testTiesFollowTheName() {
  await inRollback(async (runner) => {
    const migration = new BusinessReferences1856240000000();
    await logged(() => migration.down(runner));
    const t = await seedTenant(runner, 'bref-ties');
    const at = '2026-04-01T00:00:00Z';
    // A uuid that sorts first (0...) or last (f...), so that the uuid order is the reverse of the expected one.
    const low = () => `0${randomUUID().slice(1)}`;
    const high = () => `f${randomUUID().slice(1)}`;
    const zeta = await insert(runner, 'suppliers', t.tenantId, { id: low(), name: 'Zeta', erp_supplier_id: 'SUP-002', created_at: at });
    const alpha = await insert(runner, 'suppliers', t.tenantId, { id: high(), name: 'Alpha', erp_supplier_id: 'SUP-001', created_at: at });
    const beta = await insert(runner, 'suppliers', t.tenantId, { id: low(), name: 'Beta', created_at: at });
    const companyZ = await insert(runner, 'companies', t.tenantId, { id: low(), name: 'Zeta SA', country_iso: 'FR', city: 'Lyon', created_at: at });
    const companyA = await insert(runner, 'companies', t.tenantId, { id: high(), name: 'Alpha SA', country_iso: 'FR', city: 'Lyon', created_at: at });
    const contactZ = await insert(runner, 'contacts', t.tenantId, { id: low(), first_name: 'Anna', last_name: 'Zola', email: 'anna@example.test', created_at: at });
    const contactA = await insert(runner, 'contacts', t.tenantId, { id: high(), first_name: 'Zoe', last_name: 'Adam', email: 'zoe@example.test', created_at: at });
    const deptZ = await insert(runner, 'departments', t.tenantId, { id: low(), name: 'Zeta', company_id: companyA, created_at: at });
    const deptA = await insert(runner, 'departments', t.tenantId, { id: high(), name: 'Alpha', company_id: companyA, created_at: at });
    const contractZ = await insert(runner, 'contracts', t.tenantId, {
      id: low(), name: 'Zeta', company_id: companyA, supplier_id: alpha, start_date: '2026-01-01', created_at: at,
    });
    const contractA = await insert(runner, 'contracts', t.tenantId, {
      id: high(), name: 'Alpha', company_id: companyA, supplier_id: alpha, start_date: '2026-01-01', created_at: at,
    });
    // A number held twice by two rows of the same creation time: the first by name keeps it.
    await runner.query(`ALTER TABLE departments ADD COLUMN item_number integer`);
    await asTenant(runner, t.tenantId);
    await runner.query(`UPDATE departments SET item_number = 7 WHERE id = ANY($1::uuid[])`, [[deptZ, deptA]]);
    await runner.query(`SELECT set_config('app.current_tenant', '', true)`);

    await logged(() => migration.up(runner));

    // Suppliers: by ERP ID (SUP-001 first), the one without an ERP ID last.
    assert.deepEqual(await numbersOf(runner, 'suppliers', t.tenantId), { [alpha]: 1, [zeta]: 2, [beta]: 3 });
    assert.deepEqual(await numbersOf(runner, 'companies', t.tenantId), { [companyA]: 1, [companyZ]: 2 });
    // Contacts: by last name.
    assert.deepEqual(await numbersOf(runner, 'contacts', t.tenantId), { [contactA]: 1, [contactZ]: 2 });
    assert.deepEqual(await numbersOf(runner, 'contracts', t.tenantId), { [contractA]: 1, [contractZ]: 2 });
    // Departments: Alpha keeps 7, Zeta is numbered after it.
    assert.deepEqual(await numbersOf(runner, 'departments', t.tenantId), { [deptA]: 7, [deptZ]: 8 });
  });
}

async function testTriggerNumbersInserts() {
  await inRollback(async (runner) => {
    const a = await seedTenant(runner, 'bref-trg-a');
    const b = await seedTenant(runner, 'bref-trg-b');
    const number = async (tenantId: string, values: Record<string, unknown>) => {
      const id = await insert(runner, 'suppliers', tenantId, values);
      const [row] = await runner.query(`SELECT item_number AS n FROM suppliers WHERE id = $1`, [id]);
      return row.n as number;
    };
    assert.equal(await number(a.tenantId, { name: 'First' }), 1);
    assert.equal(await number(a.tenantId, { name: 'Second' }), 2);
    assert.equal(await number(b.tenantId, { name: 'Elsewhere' }), 1, 'each tenant has its own numbers');
    // A number given (a copy, a restore) is kept and the counter moves past it.
    assert.equal(await number(a.tenantId, { name: 'Restored', item_number: 10 }), 10);
    assert.equal(await number(a.tenantId, { name: 'After the restore' }), 11);
    // A number given below the counter leaves it where it is.
    assert.equal(await number(a.tenantId, { name: 'Old copy', item_number: 5 }), 5);
    assert.equal(await number(a.tenantId, { name: 'Next' }), 12);
    await runner.query('SAVEPOINT taken');
    await assert.rejects(number(a.tenantId, { name: 'Taken', item_number: 10 }), (err: any) => err?.code === '23505');
    await runner.query('ROLLBACK TO SAVEPOINT taken');
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [testMigrationRepairsAndNumbers, testTiesFollowTheName, testTriggerNumbersInserts]) {
      try {
        await test();
        console.log(`  ok ${test.name}`);
      } catch (err) {
        failures.push(`${test.name}: ${(err as Error).message.split('\n').slice(0, 12).join(' | ')}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`business-references.migration.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('business-references.migration.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
