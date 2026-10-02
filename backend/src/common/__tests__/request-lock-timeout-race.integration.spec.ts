import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, lastValueFrom } from 'rxjs';
import { EntityManager } from 'typeorm';
import dataSource from '../../data-source';
import { copyBudgetColumn } from '../../spend/budget-column-operations';
import { amountsService, captureAudit, noFreeze, repeat, seedLine } from '../../spend/__tests__/round-inputs.fixtures';
import {
  assert, httpStatus, Party, pgCode, progress, Race, runRaceSpecs, settle, settledWithin, sql, withRace,
} from '../../spend/__tests__/race-harness';
import { TenantInitGuard } from '../tenant-init.guard';
import { TenantInterceptor } from '../tenant.interceptor';

// Gap (plan planning/perf-scale, step 0.3, Annexe A #18), fixed by lot 1D:
// `common/request-db-timeouts.ts`. Runs in CI.
//
// The request transaction (opened by TenantInitGuard, or by TenantInterceptor
// when no guard did) runs with PostgreSQL's defaults: no lock_timeout, no
// statement_timeout, no idle_in_transaction_session_timeout. A single edit
// that meets a row a long operation holds waits until that operation ends
// (up to the proxy's 300 s), keeping one of the 20 pool connections shared by
// every tenant.
// Target (1D): `SET LOCAL statement_timeout = '30s', lock_timeout = '5s',
// idle_in_transaction_session_timeout = '60s'` next to the tenant
// `set_config`; the blocked edit gives up after about 5 s with a lock timeout
// (55P03, answered 503 `busy` by 1D's error filter) instead of waiting.
//
// Both tests drive the production openers (guard and interceptor), not a
// hand-made transaction, so they pass as soon as 1D sets the delays there.

const YEAR = 2026;
/** 1D's lock_timeout (5 s) plus a margin: the measured wait must stay below it. */
const BOUND_MS = 8_000;

class ProbeController {
  handle() {
    return undefined;
  }
}

function httpContext(req: any): ExecutionContext {
  return {
    getHandler: () => ProbeController.prototype.handle,
    getClass: () => ProbeController,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ headersSent: false }) }),
  } as unknown as ExecutionContext;
}

/**
 * One request with the production wiring: TenantInitGuard opens the tenant
 * transaction (when `guard`), TenantInterceptor runs the handler and commits or
 * rolls back.
 */
async function asRequest<T>(tenantId: string, handler: (manager: EntityManager) => Promise<T>, opts: { guard: boolean }): Promise<T> {
  const reflector = new Reflector();
  const req: any = { tenant: { id: tenantId } };
  const context = httpContext(req);
  if (opts.guard) await new TenantInitGuard(dataSource, reflector).canActivate(context);
  const interceptor = new TenantInterceptor(dataSource, reflector);
  return lastValueFrom(interceptor.intercept(context, { handle: () => from(handler(req.queryRunner.manager)) }));
}

type Delays = { lock_timeout: number; statement_timeout: number; idle_in_transaction_session_timeout: number };

async function readDelays(manager: EntityManager): Promise<Delays> {
  const rows: Array<{ name: keyof Delays; setting: string }> = await manager.query(
    `SELECT name, setting FROM pg_settings WHERE name IN ('lock_timeout', 'statement_timeout', 'idle_in_transaction_session_timeout')`,
  );
  return Object.fromEntries(rows.map((r) => [r.name, Number(r.setting)])) as Delays; // milliseconds
}

/** The request transaction carries bounded waits, whichever opener started it. */
async function requestDelays() {
  await withRace('delays', async (race) => {
    const problems: string[] = [];
    for (const guard of [true, false]) {
      const opener = guard ? 'TenantInitGuard' : 'TenantInterceptor';
      const delays = await race.track(asRequest(race.tenantId, readDelays, { guard }));
      if (!(delays.lock_timeout > 0 && delays.lock_timeout <= 5_000)) problems.push(`${opener}: lock_timeout = ${delays.lock_timeout} ms (want 5 s)`);
      if (!(delays.statement_timeout > 0)) problems.push(`${opener}: statement_timeout = ${delays.statement_timeout} ms (want 30 s)`);
      if (!(delays.idle_in_transaction_session_timeout > 0)) {
        problems.push(`${opener}: idle_in_transaction_session_timeout = ${delays.idle_in_transaction_session_timeout} ms (want 60 s)`);
      }
    }
    assert.deepEqual(problems, [], `the request transaction must bound its waits; 0 means unbounded:\n${problems.join('\n')}`);
  });
}

/**
 * A column copy holds a line's months (paused there, like a long copy busy
 * with the other lines); a budget cell save of that line, in a production
 * request transaction, must give up within the bound instead of waiting for
 * the copy.
 */
async function blockedEditGivesUp() {
  await withRace('lock-wait', async (race: Race) => {
    const line = await race.seedWith((runner) => seedLine(runner, 'opex', race.tenantId, YEAR, { planned: repeat('100', 12) }, 1));
    const copier = await race.open('column copy');
    const copyHolds = race.gate(copier, { label: 'lock the line\'s months', when: 'after', match: sql.lockOn('spend_amounts') });
    const copyWork = race.start(copier, (manager) => copyBudgetColumn(
      { manager, audit: captureAudit() as any, freeze: noFreeze },
      'opex',
      { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR, destinationColumn: 'revision', percentageIncrease: 0, overwrite: true, dryRun: false },
      null,
    ));
    assert.equal(await progress(copyWork, { party: copier, gate: copyHolds }), 'gated', 'harness: the copy must pause holding the line');

    let pid = 0;
    let pidKnown!: () => void;
    const pidRead = new Promise<void>((resolve) => { pidKnown = resolve; });
    const editWork = race.track(asRequest(race.tenantId, async (manager) => {
      [{ pid }] = await manager.query(`SELECT pg_backend_pid() AS pid`);
      pidKnown();
      return amountsService('opex', captureAudit(), noFreeze).bulkUpsert(
        line.versionId, { kind: 'monthly', year: YEAR, months: [{ period: `${YEAR}-03-01`, planned: 123 }] }, null, { manager },
      );
    }, { guard: true }));
    await Promise.race([pidRead, editWork.catch(() => undefined)]);
    const edit: Party = { name: 'budget cell save', runner: undefined as any, pid };
    const state = await progress(editWork, { party: edit });

    if (state === 'blocked') {
      const started = Date.now();
      const gaveUp = await settledWithin(editWork, BOUND_MS);
      const waited = ((Date.now() - started) / 1000).toFixed(1);
      assert.ok(
        gaveUp,
        `the budget cell save was still waiting for the copy's lock after ${waited} s: the request transaction has no lock_timeout `
        + '(it would wait until the copy ends, up to the proxy\'s 300 s, holding a pool connection)',
      );
    }
    const done = await settle(editWork);
    assert.ok(!done.ok, 'harness: the cell save cannot succeed while the copy holds the months');
    const code = pgCode(done.error);
    assert.ok(
      code === '55P03' || httpStatus(done.error) === 503,
      `the blocked cell save must end with a lock timeout (55P03, or 503 busy); it ended with ${code ?? httpStatus(done.error)}: ${(done.error as Error)?.message}`,
    );
    copyHolds.release();
    assert.ok((await settle(copyWork)).ok, 'the copy goes through once released');
  });
}

void runRaceSpecs('Request lock wait bounds', [
  ['Annexe A #18: the request transaction bounds its waits (1D)', requestDelays],
  ['Annexe A #18: a cell save blocked by a long column copy gives up within 5 s (1D)', blockedEditGivesUp],
]);
