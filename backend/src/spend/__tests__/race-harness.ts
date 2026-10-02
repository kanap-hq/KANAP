import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { EntityManager, QueryRunner } from 'typeorm';
import dataSource from '../../data-source';

// Shared harness of the race specs (`*-race.integration.spec.ts`; not a spec
// itself: the runner only picks up *.spec.ts files). Plan
// planning/perf-scale/plan-perf-concurrence.md, step 0.3.
//
// Each race is forced deterministically, never by timing:
// - every party is a request transaction on its own connection (`inRequest`),
//   committed when its service call returns, rolled back when it throws;
// - a gate pauses one party right before or right after one of its own SQL
//   statements (the QueryRunner's `query` is wrapped), while its transaction
//   stays open;
// - `progress` waits until a party reaches its gate, finishes, or waits on a
//   lock held by another party (`pg_blocking_pids`), then the spec opens the
//   next gate. A party that a future fix makes wait for a lock is seen as
//   blocked, so the same choreography keeps working once the race is fixed.
//
// Every spec runs on committed data of its own throwaway tenant (slug
// `races-…`), removed at the end whatever happens. The specs refuse `appdb`:
// run them on a dedicated database (appdb_perf).

export { assert };

/** The database name of DATABASE_URL, or null. */
export function databaseName(url = process.env.DATABASE_URL): string | null {
  if (!url) return null;
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, '')) || null;
  } catch {
    return null;
  }
}

/**
 * GitHub Actions' `appdb` is a throwaway service container: a spec whose race
 * is fixed moves into test:ci and must run there.
 */
const ON_CI = process.env.GITHUB_ACTIONS === 'true';

/** Refuses to run without DATABASE_URL or against `appdb` (the developer database), except on CI. */
export function assertRaceDatabase() {
  const name = databaseName();
  if (!name) throw new Error('DATABASE_URL is required: the race specs run on a dedicated database such as appdb_perf.');
  if (name === 'appdb' && !ON_CI) {
    throw new Error('The race specs never run against appdb: point DATABASE_URL at a dedicated database (appdb_perf).');
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---- SQL matchers (TypeORM quotes table names, raw SQL does not) ---- */

const tableRe = (table: string) => new RegExp(`(^|[^\\w])"?${table}"?([^\\w]|$)`, 'i');

export const sql = {
  /** Any statement that names the table (not a table whose name merely ends with it). */
  touches: (table: string) => (text: string) => tableRe(table).test(text),
  select: (table: string) => (text: string) => /^\s*SELECT\b/i.test(text) && tableRe(table).test(text),
  insertInto: (table: string) => (text: string) => new RegExp(`^\\s*INSERT\\s+INTO\\s+"?${table}"?[\\s(]`, 'i').test(text),
  update: (table: string) => (text: string) => new RegExp(`^\\s*UPDATE\\s+"?${table}"?\\s`, 'i').test(text),
  deleteFrom: (table: string) => (text: string) => new RegExp(`^\\s*DELETE\\s+FROM\\s+"?${table}"?(\\s|$)`, 'i').test(text),
  /** A row-locking read of the table (`FOR UPDATE` / `FOR NO KEY UPDATE`). */
  lockOn: (table: string) => (text: string) => /\bFOR\s+(NO\s+KEY\s+)?UPDATE\b/i.test(text) && tableRe(table).test(text),
};

/* ---- Parties, gates and progress ---- */

export type Party = { name: string; runner: QueryRunner; pid: number };

export type Gate = {
  label: string;
  /** Resolves once the party reached the gate (and is paused there). */
  reached: Promise<void>;
  readonly hit: boolean;
  release: () => void;
};

export type GateRule = {
  label: string;
  /** Pause right before the matching statement runs, or right after it returned. */
  when: 'before' | 'after';
  match: (text: string) => boolean;
  /** Which matching statement (1 = the first). */
  nth?: number;
};

export type Progress = 'settled' | 'gated' | 'blocked';

export type Outcome<T = unknown> = { ok: true; value: T } | { ok: false; error: unknown };

export async function settle<T>(work: Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await work };
  } catch (error) {
    return { ok: false, error };
  }
}

/** The SQLSTATE of a driver error (TypeORM wraps it in a QueryFailedError). */
export function pgCode(error: unknown): string | undefined {
  const e = error as any;
  return e?.code ?? e?.driverError?.code ?? undefined;
}

export function httpStatus(error: unknown): number | undefined {
  return error instanceof HttpException ? error.getStatus() : undefined;
}

/** One line describing an outcome, for assertion messages. */
export function describe(outcome: Outcome): string {
  if (outcome.ok) return 'succeeded';
  const error = outcome.error as any;
  const status = httpStatus(error);
  if (status) return `HTTP ${status} ${error?.constructor?.name}: ${error?.message}`;
  const code = pgCode(error);
  const constraint = error?.constraint ?? error?.driverError?.constraint;
  if (code) return `raw database error ${code}${constraint ? ` (${constraint})` : ''}: ${error?.message}`;
  return `${error?.constructor?.name ?? 'Error'}: ${error?.message ?? String(error)}`;
}

/** The party succeeded. */
export function assertSucceeded(outcome: Outcome, who: string) {
  assert.ok(outcome.ok, `${who} must succeed; it ended with ${describe(outcome)}`);
}

/**
 * The party succeeded, or was refused with one of the given HTTP statuses (a
 * clean, mappable answer). A raw database error (unique, foreign key,
 * deadlock…) never passes.
 */
export function assertClean(outcome: Outcome, who: string, statuses: number[]) {
  if (outcome.ok) return;
  const status = httpStatus(outcome.error);
  assert.ok(
    status !== undefined && statuses.includes(status),
    `${who} must succeed or be refused with HTTP ${statuses.join('/')}; it ended with ${describe(outcome)}`,
  );
}

/** One request transaction on the party's connection: tenant set locally, commit on success, rollback on error. */
export async function inRequest<T>(party: Party, tenantId: string, fn: (manager: EntityManager) => Promise<T>): Promise<T> {
  const { runner } = party;
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const result = await fn(runner.manager);
    await runner.commitTransaction();
    return result;
  } catch (error) {
    if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
    throw error;
  }
}

/** Whether the backend waits on a lock held by another backend. */
export async function isBlocked(pid: number): Promise<boolean> {
  const [row] = await dataSource.query(`SELECT cardinality(pg_blocking_pids($1::int)) AS n`, [pid]);
  return Number(row?.n ?? 0) > 0;
}

/**
 * Waits until the work finished, its party reached the gate, or its party
 * waits on a lock. The deadline only guards the harness itself (a party that
 * neither moves nor waits on a lock is a broken choreography).
 */
export async function progress(work: Promise<unknown>, opts: { party?: Party; gate?: Gate; deadlineMs?: number }): Promise<Progress> {
  let settled = false;
  work.then(() => { settled = true; }, () => { settled = true; });
  const deadline = Date.now() + (opts.deadlineMs ?? 20_000);
  const seen = (state: Progress) => {
    // RACE_TRACE=1 prints the choreography (which party finished, paused or waited).
    if (process.env.RACE_TRACE) console.log(`        · ${opts.party?.name ?? 'work'}: ${state}${state === 'gated' ? ` (${opts.gate?.label})` : ''}`);
    return state;
  };
  for (;;) {
    // Let the work's continuations run first.
    await sleep(5);
    if (settled) return seen('settled');
    if (opts.gate?.hit) return seen('gated');
    if (opts.party && (await isBlocked(opts.party.pid))) return seen('blocked');
    if (Date.now() > deadline) {
      throw new Error(`harness: ${opts.party?.name ?? 'the work'} neither finished, reached ${opts.gate?.label ?? 'a gate'} nor waited on a lock`);
    }
  }
}

/** Waits until the work finished or the time is up; true when it finished. A measurement, not a synchronisation. */
export async function settledWithin(work: Promise<unknown>, ms: number): Promise<boolean> {
  let settled = false;
  work.then(() => { settled = true; }, () => { settled = true; });
  const deadline = Date.now() + ms;
  while (!settled && Date.now() < deadline) await sleep(20);
  return settled;
}

/* ---- One race: its tenant, connections, gates and pending work ---- */

export class Race {
  private readonly parties: Party[] = [];
  private readonly gates: Gate[] = [];
  private readonly work: Promise<unknown>[] = [];

  constructor(readonly tenantId: string) {}

  /** A party on its own connection (no transaction yet). */
  async open(name: string): Promise<Party> {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    const [row] = await runner.query(`SELECT pg_backend_pid() AS pid`);
    const party = { name, runner, pid: Number(row.pid) };
    this.parties.push(party);
    return party;
  }

  /** Pause the party at one of its statements; released by `gate.release()` (and always at the end of the race). */
  gate(party: Party, rule: GateRule): Gate {
    const runner = party.runner as any;
    const original = runner.query.bind(runner);
    let seen = 0;
    let hit = false;
    let reach!: () => void;
    const reached = new Promise<void>((resolve) => { reach = resolve; });
    let open!: () => void;
    const opened = new Promise<void>((resolve) => { open = resolve; });
    runner.query = async (text: string, ...rest: unknown[]) => {
      const here = !hit && typeof text === 'string' && rule.match(text) && ++seen === (rule.nth ?? 1);
      if (here && rule.when === 'before') {
        hit = true;
        reach();
        await opened;
      }
      const result = await original(text, ...rest);
      if (here && rule.when === 'after') {
        hit = true;
        reach();
        await opened;
      }
      return result;
    };
    const gate: Gate = { label: `${party.name}: ${rule.label}`, reached, get hit() { return hit; }, release: open };
    this.gates.push(gate);
    return gate;
  }

  /** Start one request of the party (see `inRequest`). */
  start<T>(party: Party, fn: (manager: EntityManager) => Promise<T>): Promise<T> {
    const work = inRequest(party, this.tenantId, fn);
    this.work.push(work.catch(() => undefined));
    return work;
  }

  /** Work that runs outside `start` (its own request wiring), waited for at the end of the race. */
  track<T>(work: Promise<T>): Promise<T> {
    this.work.push(work.catch(() => undefined));
    return work;
  }

  /** Committed seed data of the race tenant (see `seed`). */
  seedWith<T>(fn: (runner: QueryRunner) => Promise<T>): Promise<T> {
    return seed(this.tenantId, fn);
  }

  /** Rows read in a fresh transaction of the race tenant. */
  async read<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
    return dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [this.tenantId]);
      return manager.query(text, params);
    });
  }

  async readOne<T = any>(text: string, params: unknown[] = []): Promise<T | undefined> {
    return (await this.read<T>(text, params))[0];
  }

  /** Opens every gate, lets pending work finish (bounded), then rolls back and releases every connection. */
  async close() {
    for (const gate of this.gates) gate.release();
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([Promise.allSettled(this.work), new Promise((resolve) => { timer = setTimeout(resolve, 15_000); })]);
    clearTimeout(timer);
    for (const { runner } of this.parties) {
      if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
      await runner.release().catch(() => undefined);
    }
  }
}

/* ---- Tenants ---- */

/** A committed throwaway tenant (slug `races-<tag>-<id>`). */
export async function createRaceTenant(tag: string): Promise<string> {
  const tenantId = randomUUID();
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `races-${tag}-${tenantId.slice(0, 8)}`.slice(0, 60), `Races ${tag}`],
  );
  return tenantId;
}

/** Seeds committed data in one transaction of the tenant (fixtures take a QueryRunner). */
export async function seed<T>(tenantId: string, fn: (runner: QueryRunner) => Promise<T>): Promise<T> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const result = await fn(runner);
    await runner.commitTransaction();
    return result;
  } catch (error) {
    if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
    throw error;
  } finally {
    await runner.release();
  }
}

let tenantTables: string[] | null = null;

/**
 * Removes every row of the tenant, then the tenant. Many tables have no
 * foreign key to `tenants`, so each table with a tenant_id is emptied for the
 * tenant, in passes until the foreign keys between them stop refusing.
 */
export async function dropRaceTenant(tenantId: string) {
  tenantTables ??= (await dataSource.query(
    `SELECT c.relname AS name
     FROM pg_class c
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
     WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace AND c.relname <> 'tenants'
     ORDER BY c.relname`,
  )).map((row: { name: string }) => row.name);
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  let left: string[] = [...tenantTables!];
  try {
    await runner.startTransaction();
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    for (let pass = 0; pass < 8 && left.length > 0; pass++) {
      const failed: string[] = [];
      for (const table of left) {
        await runner.query('SAVEPOINT race_cleanup');
        try {
          await runner.query(`DELETE FROM "${table}" WHERE tenant_id = $1`, [tenantId]);
          await runner.query('RELEASE SAVEPOINT race_cleanup');
        } catch {
          await runner.query('ROLLBACK TO SAVEPOINT race_cleanup');
          failed.push(table);
        }
      }
      left = failed;
    }
    if (left.length > 0) console.warn(`cleanup of tenant ${tenantId}: rows left in ${left.join(', ')}`);
    await runner.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await runner.commitTransaction();
  } catch (error) {
    if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
    console.error(`cleanup of tenant ${tenantId} failed (tables left: ${left.join(', ') || '-'}): ${(error as Error).message}`);
  } finally {
    await runner.release();
  }
}

/** Runs one race on its own tenant; the tenant and every connection are gone afterwards. */
export async function withRace(tag: string, fn: (race: Race) => Promise<void>) {
  const tenantId = await createRaceTenant(tag);
  const race = new Race(tenantId);
  try {
    await fn(race);
  } finally {
    await race.close();
    await dropRaceTenant(tenantId);
  }
}

/* ---- Runner ---- */

/**
 * Runs the named races and exits non-zero when one fails. A race spec fails
 * today by design: it is the acceptance test of the fix named in its header.
 */
export async function runRaceSpecs(name: string, tests: Array<[string, () => Promise<void>]>) {
  assertRaceDatabase();
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    const [identity] = await dataSource.query(
      `SELECT current_database() AS db, current_user AS name, rolsuper FROM pg_roles WHERE rolname = current_user`,
    );
    if (identity?.db === 'appdb' && !ON_CI) throw new Error('The race specs never run against appdb.');
    assert.equal(identity?.rolsuper, false, `the race specs must use the non-superuser app role (RLS enforced), got ${identity?.name}`);
    for (const [label, test] of tests) {
      try {
        await test();
        console.log(`  ok    ${label}`);
      } catch (err) {
        const message = (err as Error)?.message ?? String(err);
        console.log(`  FAIL  ${label}\n        ${message.split('\n').join('\n        ')}`);
        failures.push(label);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    console.error(`${name}: ${failures.length} of ${tests.length} failing`);
    process.exit(1);
  }
  console.log(`${name}: ok`);
}
