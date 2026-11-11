import * as assert from 'node:assert/strict';
import { isPersonRun, runResultAccess } from '../control-plane/evidence/run-result-visibility';

// Which runs belong to a person, and who reads what their tools returned.

const AUTHOR = 'user-author';
const OTHER = 'user-other';
const run = (invocation_channel: string, trigger_kind: string, user_id: string | null = AUTHOR) =>
  ({ invocation_channel, trigger_kind, user_id });

function testOriginOfARun() {
  // Every origin the dispatcher and the MCP journal write.
  assert.equal(isPersonRun(run('chat', 'human_user')), true);
  assert.equal(isPersonRun(run('internal', 'human_user')), true);
  assert.equal(isPersonRun(run('mcp', 'mcp_client')), true);
  assert.equal(isPersonRun(run('internal', 'internal')), false);
  assert.equal(isPersonRun(run('scheduler', 'scheduled_trigger')), false);
  assert.equal(isPersonRun(run('alert', 'alert_trigger')), false);
  // An origin nobody writes today is a person's until it is declared an agent's.
  assert.equal(isPersonRun(run('chat', 'internal')), true);
  assert.equal(isPersonRun(run('webhook', 'internal')), true);
  assert.equal(isPersonRun(run('internal', 'webhook')), true);
  assert.equal(isPersonRun(run(undefined as any, undefined as any)), true);
}

async function testWhoReadsAResult() {
  let asked = 0;
  const reads = (userId: string | null, everyResult: boolean) => runResultAccess(userId, async () => {
    asked += 1;
    return everyResult;
  });

  // An agent's run: everyone the screen lets in, and the question is never asked.
  assert.equal(await reads(OTHER, false)(run('internal', 'internal')), true);
  assert.equal(await reads(null, false)(run('scheduler', 'scheduled_trigger', null)), true);
  // A person's run: its author.
  assert.equal(await reads(AUTHOR, false)(run('chat', 'human_user')), true);
  assert.equal(await reads(AUTHOR, false)(run('mcp', 'mcp_client')), true);
  assert.equal(asked, 0);

  // Somebody else: only who reads every result.
  assert.equal(await reads(OTHER, false)(run('chat', 'human_user')), false);
  assert.equal(await reads(OTHER, true)(run('chat', 'human_user')), true);
  assert.equal(await reads(OTHER, false)(run('mcp', 'mcp_client')), false);
  // A run without a person, read by a request without one.
  assert.equal(await reads(null, false)(run('chat', 'human_user', null)), false);
  assert.equal(await reads('', false)(run('chat', 'human_user', '')), false);

  // One request asks once, however many runs it lists.
  asked = 0;
  const access = reads(OTHER, true);
  for (let i = 0; i < 5; i += 1) await access(run('chat', 'human_user'));
  assert.equal(asked, 1);
}

async function main() {
  testOriginOfARun();
  await testWhoReadsAResult();
  console.log('ai-run-result-visibility.spec: all passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
