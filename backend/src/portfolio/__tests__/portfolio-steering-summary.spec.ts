import * as assert from 'node:assert/strict';
import { PortfolioSteeringSummaryService } from '../services/portfolio-steering-summary.service';

/**
 * The steering summary reads tasks, requests, projects, attention and stale projects on the
 * request's connection. Two queries in flight at once are the node-postgres warning
 * (`client.query() when the client is already executing a query`).
 */
const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function busyManager() {
  let busy = 0;
  const calls: string[] = [];
  const manager = {
    query: async (sql: string) => {
      if (busy > 0) throw new Error('client.query() when the client is already executing a query');
      busy += 1;
      try {
        await new Promise((resolve) => setImmediate(resolve));
        calls.push(sql);
        return [];
      } finally {
        busy -= 1;
      }
    },
  };
  return { manager, calls };
}

async function testSummaryReadsRunOneAfterTheOther() {
  const { manager, calls } = busyManager();
  const summary = await new PortfolioSteeringSummaryService().getSummary(TENANT, {}, { manager: manager as any });
  assert.equal(calls.length, 5, 'one statement per block');
  assert.equal(summary.tasks.openNow, 0);
  assert.equal(summary.requests.openNow, 0);
  assert.equal(summary.projects.openNow, 0);
  assert.equal(summary.attention.overdueTasks, 0);
  assert.deepEqual(summary.attention.staleProjects, []);
}

async function testGuardRejectsTwoQueriesAtOnce() {
  const { manager } = busyManager();
  await assert.rejects(
    () => Promise.all([manager.query('SELECT 1'), manager.query('SELECT 2')]),
    /already executing a query/,
  );
}

(async () => {
  await testGuardRejectsTwoQueriesAtOnce();
  await testSummaryReadsRunOneAfterTheOther();
  console.log('portfolio-steering-summary.spec.ts: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
