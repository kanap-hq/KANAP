import 'dotenv/config';
import * as assert from 'node:assert/strict';
import dataSource from '../../data-source';
import { computeContractTerms, contractTermsSql } from '../contract-terms';
import { CONTRACT_TERM_CASES, contractTermSweep } from './contract-terms.cases';

// The contract term rule in SQL (contractTermsSql) gives the TypeScript values
// (computeContractTerms), the list's next due date and state included: on the hand-worked cases, through both the scalar expressions the
// list sorts and filters on and the lateral row the expiry warnings join; then on every
// combination of the sweep. The rows are literal values (unnest), so the spec needs no
// table and runs on an empty database.

type SqlRow = {
  id: number;
  term_index: number;
  current_term_end: string;
  next_cancellation_deadline: string | null;
  cancellation_deadline: string;
  renews_at_term_end: boolean;
  next_due_date: string | null;
  term_state: string;
};

type Input = { today: string; start: string; months: number | null; notice: number | null; renewal: boolean; disabledAt: string | null };

const SOURCE = `unnest($1::int[], $2::date[], $3::int[], $4::int[], $5::bool[], $6::timestamptz[], $7::date[])
  AS v(id, start_date, duration_months, notice_period_months, auto_renewal, disabled_at, today)`;

function params(rows: Input[]): unknown[] {
  return [
    rows.map((_, i) => i),
    rows.map((r) => r.start),
    rows.map((r) => r.months),
    rows.map((r) => r.notice),
    rows.map((r) => r.renewal),
    rows.map((r) => r.disabledAt),
    rows.map((r) => r.today),
  ];
}

const ymd = (column: string) => `to_char(${column}, 'YYYY-MM-DD')`;

async function viaLateral(rows: Input[]): Promise<SqlRow[]> {
  const terms = contractTermsSql('v', 'v.today');
  return dataSource.query(
    `SELECT v.id, t.term_index, ${ymd('t.current_term_end')} AS current_term_end,
            ${ymd('t.next_cancellation_deadline')} AS next_cancellation_deadline,
            ${ymd('t.cancellation_deadline')} AS cancellation_deadline, t.renews_at_term_end,
            ${ymd('t.next_due_date')} AS next_due_date, t.term_state
       FROM ${SOURCE}
       CROSS JOIN LATERAL (${terms.row}) t
      ORDER BY v.id`,
    params(rows),
  );
}

async function viaScalars(rows: Input[]): Promise<SqlRow[]> {
  const terms = contractTermsSql('v', 'v.today');
  return dataSource.query(
    `SELECT v.id, ${terms.termIndex} AS term_index, ${ymd(terms.currentTermEnd)} AS current_term_end,
            ${ymd(terms.nextCancellationDeadline)} AS next_cancellation_deadline,
            ${ymd(terms.cancellationDeadline)} AS cancellation_deadline, ${terms.renewsAtTermEnd} AS renews_at_term_end,
            ${ymd(terms.nextDueDate)} AS next_due_date, ${terms.termState} AS term_state
       FROM ${SOURCE}
      ORDER BY v.id`,
    params(rows),
  );
}

function expectedOf(row: Input): Omit<SqlRow, 'id'> {
  const t = computeContractTerms(
    { start_date: row.start, duration_months: row.months, notice_period_months: row.notice, auto_renewal: row.renewal, disabled_at: row.disabledAt },
    row.today,
  );
  return {
    term_index: t.term_index,
    current_term_end: t.current_term_end,
    next_cancellation_deadline: t.next_cancellation_deadline,
    cancellation_deadline: t.cancellation_deadline,
    renews_at_term_end: t.renews_at_term_end,
    next_due_date: t.next_due_date,
    term_state: t.term_state,
  };
}

const strip = ({ id: _id, ...rest }: SqlRow) => ({ ...rest, term_index: Number(rest.term_index) });

async function main() {
  await dataSource.initialize();
  try {
    const cases: Input[] = CONTRACT_TERM_CASES.map((c) => ({
      today: c.today, start: c.start, months: c.months, notice: c.notice, renewal: c.renewal, disabledAt: c.disabledAt ?? null,
    }));
    for (const [label, run] of [['lateral row', viaLateral], ['scalar expressions', viaScalars]] as const) {
      const got = await run(cases);
      assert.equal(got.length, cases.length, `${label}: one row per case`);
      CONTRACT_TERM_CASES.forEach((c, i) => {
        assert.deepEqual(strip(got[i]), c.expected, `${label}, ${c.name}`);
        assert.deepEqual(strip(got[i]), expectedOf(cases[i]), `${label}, ${c.name}: same as TypeScript`);
      });
    }

    const sweep = contractTermSweep();
    const got = await viaLateral(sweep);
    assert.equal(got.length, sweep.length, 'sweep: one row per combination');
    let mismatches = 0;
    const first: string[] = [];
    sweep.forEach((row, i) => {
      const sql = strip(got[i]);
      const ts = expectedOf(row);
      if (JSON.stringify(sql) !== JSON.stringify(ts)) {
        mismatches += 1;
        if (first.length < 5) first.push(`${JSON.stringify(row)}\n    sql ${JSON.stringify(sql)}\n    ts  ${JSON.stringify(ts)}`);
      }
    });
    assert.equal(mismatches, 0, `sweep: SQL and TypeScript differ on ${mismatches} of ${sweep.length} rows\n  ${first.join('\n  ')}`);

    console.log(`contract-terms.parity.spec: ok (${CONTRACT_TERM_CASES.length} cases, ${sweep.length} sweep rows)`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
