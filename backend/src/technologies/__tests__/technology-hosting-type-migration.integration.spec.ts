// @database-spec
import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import { TechnologyHostingType1854310000000 as Migration } from '../../migrations/1854310000000-technology-hosting-type';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { technology } from './technologies.fixtures';

// Migration 1854310000000 (`technologies.hosting_type` replaces `technologies.mode`), against a
// real database, in transactions rolled back at the end:
// - as migrated: text, NOT NULL, default on_prem, no `mode`; a second up() changes nothing and
//   keeps the values; the search index carries the type;
// - dirty database: `mode` back (down()) without its CHECK and with an unknown value, the column
//   already there as varchar with blank, padded and real values, a tenant whose catalog has
//   neither on_prem nor saas. up() fills per tenant from the mode (installed on premises,
//   subscribed SaaS, unknown on premises, in the tenant's own codes), keeps and normalises the
//   values already there, logs the counts, drops `mode`; a rerun changes nothing;
// - down() then up(): the mode comes back from the category of each type, then the type from the mode.

const migration = new Migration();

type Shape = { hosting_type: { data_type: string; is_nullable: string; column_default: string | null } | null; mode: boolean };

async function shape(runner: QueryRunner): Promise<Shape> {
  const rows: Array<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }> = await runner.query(
    `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'technologies' AND column_name IN ('hosting_type', 'mode')`,
  );
  const hosting = rows.find((row) => row.column_name === 'hosting_type');
  return {
    hosting_type: hosting ? { data_type: hosting.data_type, is_nullable: hosting.is_nullable, column_default: hosting.column_default } : null,
    mode: rows.some((row) => row.column_name === 'mode'),
  };
}

const EXPECTED: Shape = { hosting_type: { data_type: 'text', is_nullable: 'NO', column_default: `'on_prem'::text` }, mode: false };

async function logged(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines;
}

async function typesOf(runner: QueryRunner, tenantId: string): Promise<Record<string, string>> {
  await setTenant(runner, tenantId);
  const rows: Array<{ name: string; hosting_type: string }> = await runner.query(
    `SELECT name, hosting_type FROM technologies WHERE tenant_id = $1 ORDER BY name`,
    [tenantId],
  );
  return Object.fromEntries(rows.map((row) => [row.name, row.hosting_type]));
}

type Pending = { filled: number; unknown: number; normalized: number };

/**
 * What up() will repair in `tenantIds` (every tenant when absent), counted per tenant under its
 * policy: the database may hold technologies of other tenants, which up() repairs and logs too.
 */
async function pending(runner: QueryRunner, tenantIds?: string[]): Promise<Pending> {
  const ids: string[] = tenantIds ?? (await runner.query(`SELECT id FROM tenants`)).map((row: { id: string }) => row.id);
  const total: Pending = { filled: 0, unknown: 0, normalized: 0 };
  for (const id of ids) {
    await setTenant(runner, id);
    const [row] = await runner.query(
      `SELECT count(*) FILTER (WHERE hosting_type IS NULL OR btrim(hosting_type) = '')::int AS filled,
              count(*) FILTER (WHERE (hosting_type IS NULL OR btrim(hosting_type) = '')
                                 AND mode IS DISTINCT FROM 'installed' AND mode IS DISTINCT FROM 'subscribed')::int AS unknown,
              count(*) FILTER (WHERE btrim(hosting_type) <> '' AND hosting_type <> lower(btrim(hosting_type)))::int AS normalized
         FROM technologies WHERE tenant_id = $1`,
      [id],
    );
    total.filled += row.filled;
    total.unknown += row.unknown;
    total.normalized += row.normalized;
  }
  return total;
}

async function testMigratedAndRerun() {
  await inRolledBackTransaction(async (runner) => {
    assert.deepEqual(await shape(runner), EXPECTED);
    const tenantId = await seedTenant(runner, 'hst-rerun');
    const tech = await technology(runner, tenantId, 1, 'Entra ID', 'directory');
    await runner.query(`UPDATE technologies SET hosting_type = 'saas' WHERE tenant_id = $1 AND id = $2`, [tenantId, tech]);
    const log = await logged(() => migration.up(runner));
    assert.deepEqual(log, [], 'nothing to repair');
    assert.deepEqual(await shape(runner), EXPECTED);
    assert.deepEqual(await typesOf(runner, tenantId), { 'Entra ID': 'saas' });
    const [index] = await runner.query(
      `SELECT extra_json FROM search_index WHERE tenant_id = $1 AND entity_type = 'technologies' AND entity_id = $2`,
      [tenantId, tech],
    );
    assert.deepEqual(index?.extra_json, { family: 'directory', editor: null, hosting_type: 'saas' });
  });
}

async function testDirtyDatabase() {
  await inRolledBackTransaction(async (runner) => {
    await migration.down(runner);
    await runner.query(`ALTER TABLE technologies DROP CONSTRAINT technologies_mode_check`);
    await runner.query(`ALTER TABLE technologies ADD COLUMN hosting_type varchar(30) NULL DEFAULT ''`);

    const a = await seedTenant(runner, 'hst-dirty-a');
    for (const [n, name, mode, hosting] of [
      [1, 'Installed', 'installed', null],
      [2, 'Subscribed', 'subscribed', ''],
      [3, 'Unknown', 'hosted', null],
      [4, 'Padded', 'installed', '  Colocation '],
      [5, 'Kept', 'installed', 'public_cloud'],
    ] as const) {
      const id = await technology(runner, a, n, name);
      await runner.query(`UPDATE technologies SET mode = $3, hosting_type = $4 WHERE tenant_id = $1 AND id = $2`, [a, id, mode, hosting]);
    }
    // A tenant whose catalog renamed its types: no on_prem, no saas.
    const b = await seedTenant(runner, 'hst-dirty-b');
    await runner.query(
      `UPDATE tenants SET metadata = jsonb_build_object('it_ops', jsonb_build_object('hosting_types', $2::jsonb)) WHERE id = $1`,
      [b, JSON.stringify([
        { code: 'datacenter', label: 'Datacenter', category: 'on_prem' },
        { code: 'azure', label: 'Azure', category: 'cloud' },
      ])],
    );
    // A tenant that retired on premises: its installed technology goes to colocation, never to a retired type.
    const c = await seedTenant(runner, 'hst-dirty-c');
    await runner.query(
      `UPDATE tenants SET metadata = jsonb_build_object('it_ops', jsonb_build_object('hosting_types', $2::jsonb)) WHERE id = $1`,
      [c, JSON.stringify([
        { code: 'on_prem', label: 'On-prem', category: 'on_prem', deprecated: true },
        { code: 'colocation', label: 'Colocation', category: 'on_prem' },
      ])],
    );
    await setTenant(runner, c);
    await technology(runner, c, 1, 'Installed');
    await runner.query(`UPDATE technologies SET hosting_type = NULL WHERE tenant_id = $1`, [c]);
    await setTenant(runner, b);
    const onB = await technology(runner, b, 1, 'Installed');
    const saasB = await technology(runner, b, 2, 'Subscribed');
    await runner.query(`UPDATE technologies SET hosting_type = NULL WHERE tenant_id = $1`, [b]);
    await runner.query(`UPDATE technologies SET mode = 'subscribed' WHERE tenant_id = $1 AND id = $2`, [b, saasB]);
    assert.ok(onB);

    // The test tenants alone, then the whole database as up() logs it.
    assert.deepEqual(await pending(runner, [a, b]), { filled: 5, unknown: 1, normalized: 1 });
    const expected = await pending(runner);
    const log = await logged(() => migration.up(runner));
    assert.deepEqual(await shape(runner), EXPECTED);
    assert.deepEqual(await typesOf(runner, a), {
      Installed: 'on_prem', Subscribed: 'saas', Unknown: 'on_prem', Padded: 'colocation', Kept: 'public_cloud',
    });
    assert.deepEqual(await typesOf(runner, b), { Installed: 'datacenter', Subscribed: 'azure' }, 'every tenant, in its own codes');
    assert.deepEqual(await typesOf(runner, c), { Installed: 'colocation' }, 'a retired type is never given');
    assert.equal(log.length, 1);
    assert.equal(
      log[0],
      `[migration 1854310000000] technologies.hosting_type: ${expected.filled} filled from the mode`
      + ` (${expected.unknown} with an unknown mode, set on premises), ${expected.normalized} trimmed or lowercased`,
    );
    await setTenant(runner, b);
    const [index] = await runner.query(
      `SELECT extra_json->>'hosting_type' AS type FROM search_index WHERE tenant_id = $1 AND entity_type = 'technologies' AND entity_id = $2`,
      [b, saasB],
    );
    assert.equal(index?.type, 'azure', 'the search index follows');

    const again = await logged(() => migration.up(runner));
    assert.deepEqual(again, [], 'a rerun repairs nothing');
    assert.deepEqual(await shape(runner), EXPECTED);
    assert.deepEqual(await typesOf(runner, b), { Installed: 'datacenter', Subscribed: 'azure' });
  });
}

async function testDownThenUp() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seedTenant(runner, 'hst-down');
    for (const [n, type] of [[1, 'on_prem'], [2, 'colocation'], [3, 'public_cloud'], [4, 'saas'], [5, 'gone']] as const) {
      const id = await technology(runner, a, n, type);
      await runner.query(`UPDATE technologies SET hosting_type = $3 WHERE tenant_id = $1 AND id = $2`, [a, id, type]);
    }
    await migration.down(runner);
    assert.deepEqual(await shape(runner), { hosting_type: null, mode: true });
    await setTenant(runner, a);
    const rows: Array<{ name: string; mode: string }> = await runner.query(`SELECT name, mode FROM technologies WHERE tenant_id = $1`, [a]);
    assert.deepEqual(Object.fromEntries(rows.map((row) => [row.name, row.mode])), {
      on_prem: 'installed', colocation: 'installed', public_cloud: 'subscribed', saas: 'subscribed', gone: 'subscribed',
    });
    const [check] = await runner.query(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'technologies_mode_check'`);
    assert.match(String(check?.def), /installed.*subscribed/);

    await migration.up(runner);
    assert.deepEqual(await shape(runner), EXPECTED);
    assert.deepEqual(await typesOf(runner, a), {
      on_prem: 'on_prem', colocation: 'on_prem', public_cloud: 'saas', saas: 'saas', gone: 'saas',
    });
  });
}

void runSpecs('Technology hosting type migration', [
  ['as migrated, rerun', testMigratedAndRerun],
  ['dirty database: unknown mode, column already there, renamed catalog', testDirtyDatabase],
  ['down then up', testDownThenUp],
]);
