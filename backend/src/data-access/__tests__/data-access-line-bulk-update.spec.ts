import 'dotenv/config';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { writeAuditLog } from '../../audit/audit.service';
import { BudgetLinesService } from '../../spend/budget-lines.service';
import { SUMMARY_SCOPES } from '../../spend/spend-summary.builder';
import { realSummaryDeps } from '../../spend/__tests__/oracle/oracle-deps';
import { itemService } from '../../spend/__tests__/cost-center.fixtures';
import { assert, inRolledBackTransaction, runSpecs, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { Label, seed } from './data-access-line-seed';
import { PgClient, roleExists } from './data-access-test-helpers';

/**
 * Data-scoped access and "Change the selection" of the budget lines list (lot F1 of 26.11.8,
 * `spend/budget-line-bulk-edit.ts`), on the reference example (`data-access-line-seed.ts`), in the
 * person's limited transaction: the lines of the filters are those the person reads; a line they
 * read only is refused `read_only` and left as it is; a chosen line they cannot read answers
 * `not_found`, as an id that names nothing, so the count tells nothing of the lines outside their
 * access; a move outside their access is refused `placement`.
 *
 * Needs the role kanap_data_limited (CI installs it); skipped without it, failed in CI.
 */

const deps = realSummaryDeps(SUMMARY_SCOPES.opex);
const dbAudit = { log: (entry: any, opts?: { manager?: any }) => writeAuditLog(opts!.manager, entry) };

function service(): BudgetLinesService {
  return new BudgetLinesService(
    deps.allocationCalculator as any,
    deps.fxRates as any,
    undefined as any,
    undefined as any,
    itemService('opex', dbAudit),
    itemService('capex', dbAudit),
    undefined as any,
  );
}

void runSpecs('data-access-line-bulk-update', [
  ['limited access: only the lines of the person change, nothing leaks out of the count', () => inRolledBackTransaction(async (runner) => {
    const client: PgClient = {
      connect: async () => undefined,
      end: async () => undefined,
      query: async (sql: string, params?: unknown[]) => ({ rows: await runner.query(sql, params) }),
    };
    if (!(await roleExists(client))) {
      if (process.env.CI) throw new Error('the role kanap_data_limited is missing');
      console.log('data-access-line-bulk-update: skipped (no kanap_data_limited role)');
      return;
    }
    const s = await seed(client);
    const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Limited bulk supplier') RETURNING id`, [s.tenantId]);
    // Marta (company ES, edit) reads L2 to L5 and modifies L3 to L5.
    await runner.query(`SELECT data_access_apply($1)`, [s.persons.marta]);
    const svc = service();
    const opts = { manager: runner.manager };
    const body = { all: true, filters: {}, changes: { supplier_id: supplier.id } };
    const dry = await svc.bulkUpdate({ ...body, dry_run: true }, s.persons.marta, opts);
    assert.equal(dry.rows, 4, 'only the lines she reads are counted');
    assert.equal(dry.changes, 3);
    assert.deepEqual(dry.refused, { read_only: 1 });
    const done = await svc.bulkUpdate({ ...body, as_of: dry.as_of, expected_rows: dry.rows }, s.persons.marta, opts);
    assert.equal(done.changed, 3);
    assert.deepEqual(done.refused, { read_only: 1 });
    // A line she cannot read, named by id: the same answer as an id that names nothing.
    const hidden = await svc.bulkUpdate({ ids: [s.lines.L1, randomUUID()], changes: { supplier_id: supplier.id }, dry_run: true }, s.persons.marta, opts);
    assert.deepEqual(hidden, { ...hidden, rows: 2, changes: 0, refused: { not_found: 2 } });
    // Moving one of her lines to a company outside her access.
    const moved = await svc.bulkUpdate({ ids: [s.lines.L4], changes: { paying_company_id: s.fr }, dry_run: true }, s.persons.marta, opts);
    assert.deepEqual(moved.refused, { placement: 1 });
    await runner.query('RESET ROLE');
    await setTenant(runner, s.tenantId);
    const supplierOf = async (label: Label) => (await runner.query(`SELECT supplier_id::text AS v FROM spend_items WHERE id = $1`, [s.lines[label]]))[0]?.v ?? null;
    for (const label of ['L3', 'L4', 'L5'] as const) assert.equal(await supplierOf(label), supplier.id);
    for (const label of ['L1', 'L2', 'L6', 'L7'] as const) assert.equal(await supplierOf(label), null, `${label} untouched`);
  })],
]);
