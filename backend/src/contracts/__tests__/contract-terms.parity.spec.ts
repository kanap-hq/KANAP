import 'dotenv/config';
import * as assert from 'node:assert/strict';
import dataSource from '../../data-source';
import { computeContractTerms, contractCommitmentCents, contractCommitmentSql, contractTermsSql } from '../contract-terms';
import {
  CONTRACT_COMMITMENT_CASES,
  CONTRACT_CONFIRMED_RENEWAL_CASES,
  CONTRACT_TERM_CASES,
  contractCommitmentSweep,
  contractTermSweep,
} from './contract-terms.cases';

// The contract term rule in SQL (contractTermsSql) gives the TypeScript values
// (computeContractTerms), the list's next due date and state included: on the hand-worked cases, through both the scalar expressions the
// list sorts and filters on and the lateral row the expiry warnings join; then on every
// combination of the sweep. The commitment of a year (contractCommitmentSql, lot CB) gives the
// cents of contractCommitmentCents on its cases and its own sweep. A confirmed renewal (lot CR2,
// `renewalConfirmed`) is checked on its hand-worked cases (the term end confirmed as a column) and
// on the whole sweep with a test on the term end's day, so both sides must ask about the same
// term. The rows are literal values (unnest), so the spec needs no table and runs on an empty
// database; the audit log reading (`renewalConfirmedSql`) is covered by
// contract-renewal.integration.spec.ts.

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

type Input = {
  today: string; start: string; months: number | null; notice: number | null; renewal: boolean; disabledAt: string | null;
  /** The term whose renewal is confirmed, for the `confirmed` modes. */
  confirmed?: string | null;
};

const SOURCE = `unnest($1::int[], $2::date[], $3::int[], $4::int[], $5::bool[], $6::timestamptz[], $7::date[], $8::date[])
  AS v(id, start_date, duration_months, notice_period_months, auto_renewal, disabled_at, today, confirmed_term_end)`;

/**
 * Which renewals are confirmed: none (the option left out), the term ending on the row's
 * `confirmed` day, or every term ending on an even day (the sweep).
 */
type Confirmed = 'none' | 'column' | 'even-day';

function sqlOptions(mode: Confirmed) {
  if (mode === 'column') return { renewalConfirmed: (termEnd: string) => `${termEnd} = v.confirmed_term_end` };
  if (mode === 'even-day') return { renewalConfirmed: (termEnd: string) => `EXTRACT(DAY FROM ${termEnd})::int % 2 = 0` };
  return undefined;
}

function tsOptions(mode: Confirmed, row: Input) {
  if (mode === 'column') return { renewalConfirmed: (termEnd: string) => termEnd === row.confirmed };
  if (mode === 'even-day') return { renewalConfirmed: (termEnd: string) => Number(termEnd.slice(8, 10)) % 2 === 0 };
  return undefined;
}

function params(rows: Input[]): unknown[] {
  return [
    rows.map((_, i) => i),
    rows.map((r) => r.start),
    rows.map((r) => r.months),
    rows.map((r) => r.notice),
    rows.map((r) => r.renewal),
    rows.map((r) => r.disabledAt),
    rows.map((r) => r.today),
    rows.map((r) => r.confirmed ?? null),
  ];
}

const ymd = (column: string) => `to_char(${column}, 'YYYY-MM-DD')`;

async function viaLateral(rows: Input[], mode: Confirmed = 'none'): Promise<SqlRow[]> {
  const terms = contractTermsSql('v', 'v.today', sqlOptions(mode));
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

async function viaScalars(rows: Input[], mode: Confirmed = 'none'): Promise<SqlRow[]> {
  const terms = contractTermsSql('v', 'v.today', sqlOptions(mode));
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

function expectedOf(row: Input, mode: Confirmed = 'none'): Omit<SqlRow, 'id'> {
  const t = computeContractTerms(
    { start_date: row.start, duration_months: row.months, notice_period_months: row.notice, auto_renewal: row.renewal, disabled_at: row.disabledAt },
    row.today,
    tsOptions(mode, row),
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

type CommitmentInput = { start: string; months: number | null; renewal: boolean; disabledAt: string | null; amount: string; year: number };

/** The commitment cents of each row, by `contractCommitmentSql` on literal contract rows. */
async function commitmentsViaSql(rows: CommitmentInput[]): Promise<bigint[]> {
  const got: Array<{ id: number; cents: string }> = await dataSource.query(
    `SELECT v.id, ${contractCommitmentSql('v', 'v.yr')}::text AS cents
       FROM unnest($1::int[], $2::date[], $3::int[], $4::bool[], $5::timestamptz[], $6::numeric[], $7::int[])
         AS v(id, start_date, duration_months, auto_renewal, disabled_at, yearly_amount_at_signature, yr)
      ORDER BY v.id`,
    [
      rows.map((_, i) => i),
      rows.map((r) => r.start),
      rows.map((r) => r.months),
      rows.map((r) => r.renewal),
      rows.map((r) => r.disabledAt),
      rows.map((r) => r.amount),
      rows.map((r) => r.year),
    ],
  );
  assert.equal(got.length, rows.length, 'commitment: one row per input');
  return got.map((row) => BigInt(row.cents));
}

const commitmentOf = (r: CommitmentInput) => contractCommitmentCents(
  { start_date: r.start, duration_months: r.months, auto_renewal: r.renewal, disabled_at: r.disabledAt, yearly_amount_at_signature: r.amount },
  r.year,
);

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

    // A confirmed renewal: the hand-worked states, through both forms.
    const confirmedCases: Input[] = CONTRACT_CONFIRMED_RENEWAL_CASES.map((c) => ({
      today: c.today, start: c.start, months: c.months, notice: c.notice, renewal: c.renewal, disabledAt: c.disabledAt ?? null, confirmed: c.confirmedTermEnd,
    }));
    for (const [label, run] of [['lateral row', viaLateral], ['scalar expressions', viaScalars]] as const) {
      const got = await run(confirmedCases, 'column');
      CONTRACT_CONFIRMED_RENEWAL_CASES.forEach((c, i) => {
        assert.equal(got[i].term_state, c.expected, `${label}, confirmed renewal, ${c.name}`);
        assert.deepEqual(strip(got[i]), expectedOf(confirmedCases[i], 'column'), `${label}, confirmed renewal, ${c.name}: same as TypeScript`);
      });
    }

    const sweep = contractTermSweep();
    let toDecideLeft = 0;
    for (const mode of ['none', 'even-day'] as const) {
      const got = await viaLateral(sweep, mode);
      assert.equal(got.length, sweep.length, `sweep (${mode}): one row per combination`);
      let mismatches = 0;
      const first: string[] = [];
      sweep.forEach((row, i) => {
        const sql = strip(got[i]);
        const ts = expectedOf(row, mode);
        if (mode === 'even-day' && expectedOf(row).term_state === 'to_decide' && ts.term_state !== 'to_decide') toDecideLeft += 1;
        if (JSON.stringify(sql) !== JSON.stringify(ts)) {
          mismatches += 1;
          if (first.length < 5) first.push(`${JSON.stringify(row)}\n    sql ${JSON.stringify(sql)}\n    ts  ${JSON.stringify(ts)}`);
        }
      });
      assert.equal(mismatches, 0, `sweep (${mode}): SQL and TypeScript differ on ${mismatches} of ${sweep.length} rows\n  ${first.join('\n  ')}`);
    }
    assert.ok(toDecideLeft > 100, `the even-day sweep takes contracts out of "to decide" (${toDecideLeft})`);

    const commitmentCases: CommitmentInput[] = CONTRACT_COMMITMENT_CASES.map((c) => ({
      start: c.start, months: c.months, renewal: c.renewal, disabledAt: c.disabledAt ?? null, amount: String(c.amount), year: c.year,
    }));
    const caseCents = await commitmentsViaSql(commitmentCases);
    CONTRACT_COMMITMENT_CASES.forEach((c, i) => {
      assert.equal(caseCents[i], BigInt(Math.round(c.expected * 100)), `commitment SQL, ${c.name}`);
      assert.equal(caseCents[i], commitmentOf(commitmentCases[i]), `commitment SQL, ${c.name}: same as TypeScript`);
    });
    const commitmentRows = contractCommitmentSweep();
    const sweepCents = await commitmentsViaSql(commitmentRows);
    let commitmentMismatches = 0;
    const firstCommitment: string[] = [];
    commitmentRows.forEach((row, i) => {
      const ts = commitmentOf(row);
      if (sweepCents[i] !== ts) {
        commitmentMismatches += 1;
        if (firstCommitment.length < 5) firstCommitment.push(`${JSON.stringify(row)}: sql ${sweepCents[i]} ts ${ts}`);
      }
    });
    assert.equal(commitmentMismatches, 0, `commitment sweep: SQL and TypeScript differ on ${commitmentMismatches} of ${commitmentRows.length} rows\n  ${firstCommitment.join('\n  ')}`);

    console.log(`contract-terms.parity.spec: ok (${CONTRACT_TERM_CASES.length} cases, ${CONTRACT_CONFIRMED_RENEWAL_CASES.length} confirmed renewal cases, ${sweep.length} sweep rows twice, ${CONTRACT_COMMITMENT_CASES.length} commitment cases, ${commitmentRows.length} commitment sweep rows)`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
