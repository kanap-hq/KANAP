// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import appDataSource from '../../data-source';
import { applyDataAccess } from '../data-access';
import { AuditService } from '../../audit/audit.service';
import { AuditLog } from '../../audit/audit.entity';
import { PortfolioProject } from '../../portfolio/portfolio-project.entity';
import { PortfolioRequest } from '../../portfolio/portfolio-request.entity';
import { PortfolioRequestsService } from '../../portfolio/portfolio-requests.service';
import { PortfolioProjectsCrudService } from '../../portfolio/services/portfolio-projects-crud.service';
import { LIMITED_ROLE, PgClient, roleExists } from './data-access-test-helpers';
import { Seed, seed } from './data-access-line-seed';

/**
 * Data-scoped access, lot 4 review fix round (planning/data-scoped-access/spec.md §5.4, §6.6): the
 * budget lines in a project's and a request's history (`include=activities`), on the reference
 * example of lot 2, in one rolled-back transaction, each reader in a savepoint after
 * `applyDataAccess`.
 *
 * Ulla (all data) replaces the object's lines with [L1], then [L1, L5]. Rita (INF-FR edit, INF
 * read) reads L1, not L5. A row written before the ids were stored names two lines.
 * - Ulla with the budget right: every label, as before; old rows unchanged.
 * - Rita with the budget right: L1's label and "1 line outside your access"; old rows counted.
 * - Without the budget right (Rita or Ulla): the number of lines only, for every row.
 * No reader ever gets a line id, and Rita never gets L5's name.
 *
 * The lines themselves (`include=financials`, `capex`, `opex`) follow the Relations tab: the lines
 * the person reads and `budget_lines_hidden` with the budget right, `null` lists and the number of
 * every linked line without it.
 *
 * Needs the role kanap_data_limited (CI installs it); skipped without it, failed in CI.
 */

const dataSource = new DataSource({ ...(appDataSource.options as any), poolSize: 2 });

function clientOf(runner: QueryRunner): PgClient {
  return { query: async (sql: string, params?: unknown[]) => ({ rows: await runner.query(sql, params as any[]) }) } as unknown as PgClient;
}

/** A stand-in for any service: every member is a function resolving to undefined. Not a thenable. */
function stub(): any {
  const fn = () => Promise.resolve(undefined);
  return new Proxy({}, { get: (_target, prop) => (prop === 'then' || typeof prop === 'symbol' ? undefined : fn) });
}

async function as(runner: QueryRunner, person: string, fn: (m: EntityManager) => Promise<void>): Promise<void> {
  await runner.query('SAVEPOINT person');
  try {
    await applyDataAccess(runner, person);
    await fn(runner.manager);
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT person');
  }
}

type Owner = 'project' | 'request';

/** The `opex_items` changes of the history, newest first, as the reader gets them. */
async function history(
  services: { projects: PortfolioProjectsCrudService; requests: PortfolioRequestsService },
  m: EntityManager,
  owner: Owner,
  id: string,
  readsBudget: boolean,
): Promise<{ changes: unknown[]; raw: string }> {
  const result: any = owner === 'project'
    ? await services.projects.get(id, { include: 'activities' }, { manager: m, readsBudget })
    : await services.requests.get(id, { include: 'activities' }, { manager: m, readsBudget });
  const changes = (result.activities as any[])
    .filter((a) => a.changed_fields?.opex_items)
    .map((a) => a.changed_fields.opex_items);
  return { changes, raw: JSON.stringify(result.activities) };
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    if (!(await roleExists(clientOf(runner)))) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
      console.log(`data access portfolio history: ${LIMITED_ROLE} not installed, skipped`);
      return;
    }
    console.log('data access portfolio history (lot 4 review fix round)');
    await runner.startTransaction();
    try {
      const s: Seed = await seed(clientOf(runner));
      const label = async (line: string) => (await runner.query(`SELECT product_name FROM spend_items WHERE id = $1`, [line]))[0].product_name as string;
      const L1 = await label(s.lines.L1);
      const L5 = await label(s.lines.L5);
      const audit = new AuditService(dataSource.getRepository(AuditLog));
      const services = {
        projects: new PortfolioProjectsCrudService(dataSource.getRepository(PortfolioProject), dataSource.getRepository(PortfolioRequest), audit, stub(), stub(), stub(), stub()),
        requests: new PortfolioRequestsService(dataSource.getRepository(PortfolioRequest), audit, stub(), stub(), stub(), stub(), stub(), stub(), stub()),
      };
      const ids: Record<Owner, string> = {
        project: (await runner.query(`INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES (app_current_tenant(), 'DA history project', 9101) RETURNING id`))[0].id,
        request: (await runner.query(`INSERT INTO portfolio_requests (tenant_id, name, item_number) VALUES (app_current_tenant(), 'DA history request', 9102) RETURNING id`))[0].id,
      };
      // A row written before the ids were stored (labels only), the oldest of each history.
      for (const owner of ['project', 'request'] as const) {
        await runner.query(
          `INSERT INTO portfolio_activities (tenant_id, ${owner}_id, author_id, type, changed_fields, created_at)
           VALUES (app_current_tenant(), $1, $2, 'change', $3::jsonb, now() - interval '1 day')`,
          [ids[owner], s.persons.ulla, JSON.stringify({ opex_items: [['Old line A'], ['Old line A', 'Old line B']] })],
        );
      }
      await applyDataAccess(runner, s.persons.ulla);
      for (const lines of [[s.lines.L1], [s.lines.L1, s.lines.L5]]) {
        await services.projects.bulkReplaceOpex(ids.project, lines, { manager: runner.manager, userId: s.persons.ulla });
        await services.requests.bulkReplaceOpex(ids.request, lines, { manager: runner.manager, userId: s.persons.ulla });
        // Distinct timestamps, so the history order is the order of the writes.
        await runner.query(`UPDATE portfolio_activities SET created_at = created_at - interval '1 minute' WHERE tenant_id = app_current_tenant()`);
      }
      const noIds = (raw: string, who: string) => {
        for (const line of Object.values(s.lines)) assert.ok(!raw.includes(line), `${who}: no line id in the history`);
      };

      for (const owner of ['project', 'request'] as const) {
        const id = ids[owner];
        // Stored: each side names its lines with their ids.
        const [stored] = await runner.query(
          `SELECT changed_fields FROM portfolio_activities WHERE ${owner}_id = $1 ORDER BY created_at DESC LIMIT 1`, [id],
        );
        assert.deepEqual(stored.changed_fields.opex_items[1].map((line: any) => line.id).sort(), [s.lines.L1, s.lines.L5].sort(), `${owner}: ids stored`);

        await as(runner, s.persons.ulla, async (m) => {
          const all = await history(services, m, owner, id, true);
          assert.deepEqual(all.changes, [
            [[L1], [L1, L5].sort((a, b) => a.localeCompare(b))],
            [[], [L1]],
            [['Old line A'], ['Old line A', 'Old line B']],
          ], `ulla, ${owner}: every label, old rows unchanged`);
          noIds(all.raw, `ulla, ${owner}`);
          const counted = await history(services, m, owner, id, false);
          assert.deepEqual(counted.changes, [
            [{ labels: null, hidden: 1 }, { labels: null, hidden: 2 }],
            [[], { labels: null, hidden: 1 }],
            [{ labels: null, hidden: 1 }, { labels: null, hidden: 2 }],
          ], `ulla without the budget right, ${owner}: counts only`);
          assert.ok(!counted.raw.includes(L1) && !counted.raw.includes('Old line'), `ulla without the budget right, ${owner}: no name`);
        });
        await as(runner, s.persons.rita, async (m) => {
          const limited = await history(services, m, owner, id, true);
          assert.deepEqual(limited.changes, [
            [[L1], { labels: [L1], hidden: 1 }],
            [[], [L1]],
            [{ labels: null, hidden: 1 }, { labels: null, hidden: 2 }],
          ], `rita, ${owner}: L1 named, L5 counted, old rows counted`);
          assert.ok(!limited.raw.includes(L5) && !limited.raw.includes('Old line'), `rita, ${owner}: L5 never named`);
          noIds(limited.raw, `rita, ${owner}`);
          const counted = await history(services, m, owner, id, false);
          assert.deepEqual(counted.changes, [
            [{ labels: null, hidden: 1 }, { labels: null, hidden: 2 }],
            [[], { labels: null, hidden: 1 }],
            [{ labels: null, hidden: 1 }, { labels: null, hidden: 2 }],
          ], `rita without the budget right, ${owner}: counts only`);
          assert.ok(!counted.raw.includes(L1), `rita without the budget right, ${owner}: no name`);
        });
      }
      console.log('  history: labels per reader, hidden lines counted, counts only without the budget right, no ids: OK');

      // The lines themselves (`include=financials`, or `capex,opex`): the same rule as the Relations
      // tab. Both objects are linked to L1 and L5 by now.
      for (const owner of ['project', 'request'] as const) {
        const read = async (m: EntityManager, include: string, readsBudget: boolean) => {
          const result: any = owner === 'project'
            ? await services.projects.get(ids[owner], { include }, { manager: m, readsBudget })
            : await services.requests.get(ids[owner], { include }, { manager: m, readsBudget });
          return {
            opex: result.opex_items === null ? null : (result.opex_items as any[]).map((line) => line.id).sort(),
            capex: result.capex_items === null ? null : (result.capex_items as any[]).map((line) => line.id),
            hidden: result.budget_lines_hidden,
            raw: JSON.stringify(result),
          };
        };
        await as(runner, s.persons.rita, async (m) => {
          for (const include of ['financials', 'capex,opex']) {
            const limited = await read(m, include, true);
            assert.deepEqual({ opex: limited.opex, capex: limited.capex, hidden: limited.hidden }, { opex: [s.lines.L1], capex: [], hidden: 1 }, `rita, ${owner} ${include}: L1 listed, L5 counted`);
            assert.ok(!limited.raw.includes(L5) && !limited.raw.includes(s.lines.L5), `rita, ${owner}: nothing of L5`);
            const counted = await read(m, include, false);
            assert.deepEqual({ opex: counted.opex, capex: counted.capex, hidden: counted.hidden }, { opex: null, capex: null, hidden: 0 }, `rita without the budget right, ${owner} ${include}: no line, no count`);
            assert.ok(!counted.raw.includes(L1), `rita without the budget right, ${owner}: no name`);
          }
        });
        await as(runner, s.persons.ulla, async (m) => {
          const all = await read(m, 'financials', true);
          assert.deepEqual({ opex: all.opex, hidden: all.hidden }, { opex: [s.lines.L1, s.lines.L5].sort(), hidden: 0 }, `ulla, ${owner}: both lines`);
          const counted = await read(m, 'financials', false);
          assert.deepEqual({ opex: counted.opex, capex: counted.capex, hidden: counted.hidden }, { opex: null, capex: null, hidden: 0 }, `ulla without the budget right, ${owner}: no line, no count`);
          assert.ok(!counted.raw.includes(L1) && !counted.raw.includes(L5), `ulla without the budget right, ${owner}: no name`);
        });
      }
      console.log('  financials: readable lines and the hidden count with the budget right, nothing without it: OK');
    } finally {
      await runner.rollbackTransaction();
    }
  } finally {
    await runner.release();
    await dataSource.destroy();
  }
  console.log('data-access-portfolio-history.spec: all passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
