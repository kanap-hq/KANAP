import { AiMutationPreviewService } from '../ai-mutation-preview.service';
import { lockBudgetLine } from '../../spend/budget-locks';
import { seedUser } from '../../spend/__tests__/cost-center.fixtures';
import { seedItem } from '../../spend/__tests__/round-inputs.fixtures';
import { assert, assertSucceeded, pgCode, progress, runRaceSpecs, settle, sql, withRace } from '../../spend/__tests__/race-harness';

// Race of the AI preview approval (plan planning/perf-scale, Annexe A #24),
// fixed in lot 3B.
//
// Approving a preview read it without a lock, checked it was pending, ran
// its operation, then saved it as executed. Two approvals of one preview (a
// double click, two tabs, the chat and the panel) both read it pending and
// both ran the operation: the write happened twice. Now the approval (and the
// rejection) reads the preview again under its row lock (FOR UPDATE): the
// second one waits, then finds it executed and returns it as it is.
//
// The 3B review added two cases: a batch locks all its previews in id order
// before it runs any (two batches sharing previews used to deadlock), and an
// approval whose line is held by another operation past the lock timeout
// leaves the preview pending, approvable again, with a plain message (it used
// to mark it failed for good with PostgreSQL's message).
//
// The operation here is a stand-in that locks the line, then adds one link to
// it, so each run can be counted.

const TOOL = 'race_counted_write';

function previewService() {
  const operation = {
    toolName: TOOL,
    businessResource: 'opex',
    executePreview: async (context: any, preview: any) => {
      await lockBudgetLine(context.manager, 'opex', context.tenantId, preview.target_entity_id);
      await context.manager.query(
        `INSERT INTO spend_links (tenant_id, spend_item_id, url, description) VALUES ($1, $2, 'https://example.com/ai', 'AI run')`,
        [context.tenantId, preview.target_entity_id],
      );
    },
    presentPreview: (preview: any) => ({
      target: { entity_type: preview.target_entity_type, entity_id: preview.target_entity_id, ref: null, title: 'Race line' },
      changes: [],
      summary: 'Add a link',
    }),
  };
  const operations = { isSupportedToolName: () => true, getOperation: () => operation };
  const policy = { assertWriteAccess: async () => undefined };
  return new AiMutationPreviewService(undefined as any, undefined as any, undefined as any, policy as any, operations as any);
}

async function seedPreview(race: Parameters<Parameters<typeof withRace>[1]>[0], count = 1) {
  return race.seedWith(async (runner) => {
    const userId = await seedUser(runner, race.tenantId, 'approver@example.com');
    const itemId = await seedItem(runner, 'opex', race.tenantId, 1);
    const previewIds: string[] = [];
    for (let i = 0; i < count; i++) {
      const [preview] = await runner.query(
        `INSERT INTO ai_mutation_previews (tenant_id, user_id, tool_name, target_entity_type, target_entity_id, mutation_input, current_values, status, expires_at)
         VALUES ($1, $2, $3, 'spend_items', $4, '{}'::jsonb, '{}'::jsonb, 'pending', now() + interval '1 hour') RETURNING id`,
        [race.tenantId, userId, TOOL, itemId],
      );
      previewIds.push(preview.id as string);
    }
    return { userId, itemId, previewId: previewIds[0], previewIds };
  });
}

async function runs(race: { read: (text: string, params?: unknown[]) => Promise<any[]> }, itemId: string): Promise<number> {
  const [row] = await race.read(`SELECT count(*)::int AS n FROM spend_links WHERE spend_item_id = $1`, [itemId]);
  return row.n;
}

/** Two approvals of one pending preview at once: the operation runs once. */
async function doubleApproval() {
  await withRace('ai-approve-twice', async (race) => {
    const { userId, itemId, previewId } = await seedPreview(race);
    const a = await race.open('approval A');
    const b = await race.open('approval B');
    const context = (manager: any) => ({ tenantId: race.tenantId, userId, manager, conversationId: null });

    const aLocked = race.gate(a, { label: 'lock the preview', when: 'after', match: sql.lockOn('ai_mutation_previews') });
    const aWork = race.start(a, (manager) => previewService().executePreview(context(manager) as any, previewId));
    assert.equal(await progress(aWork, { party: a, gate: aLocked }), 'gated', 'harness: A must pause holding the preview');
    const bWork = race.start(b, (manager) => previewService().executePreview(context(manager) as any, previewId));
    assert.equal(await progress(bWork, { party: b }), 'blocked', 'B waits for A\'s lock on the preview');
    aLocked.release();
    const [aDone, bDone] = await Promise.all([settle(aWork), settle(bWork)]);
    assertSucceeded(aDone, 'approval A');
    assertSucceeded(bDone, 'approval B');
    assert.equal((aDone as any).value.status, 'executed', 'A executed the preview');
    assert.equal((bDone as any).value.status, 'executed', 'B returns the executed preview');
    assert.equal(await runs(race, itemId), 1, 'the operation ran once (a double approval used to run it twice)');
  });
}

/** An approval and a rejection at once: the approval that holds the lock wins, the rejection changes nothing. */
async function approvalVersusRejection() {
  await withRace('ai-approve-reject', async (race) => {
    const { userId, itemId, previewId } = await seedPreview(race);
    const a = await race.open('approval');
    const b = await race.open('rejection');
    const context = (manager: any) => ({ tenantId: race.tenantId, userId, manager, conversationId: null });

    const aLocked = race.gate(a, { label: 'lock the preview', when: 'after', match: sql.lockOn('ai_mutation_previews') });
    const aWork = race.start(a, (manager) => previewService().executePreview(context(manager) as any, previewId));
    assert.equal(await progress(aWork, { party: a, gate: aLocked }), 'gated', 'harness: the approval must pause holding the preview');
    const bWork = race.start(b, (manager) => previewService().rejectPreview(context(manager) as any, previewId));
    assert.equal(await progress(bWork, { party: b }), 'blocked', 'the rejection waits for the approval\'s lock');
    aLocked.release();
    const [aDone, bDone] = await Promise.all([settle(aWork), settle(bWork)]);
    assertSucceeded(aDone, 'the approval');
    assertSucceeded(bDone, 'the rejection');
    assert.equal((bDone as any).value.status, 'executed', 'the rejection finds the preview executed and leaves it');
    const [stored] = await race.read(`SELECT status, rejected_at FROM ai_mutation_previews WHERE id = $1`, [previewId]);
    assert.deepEqual([stored.status, stored.rejected_at], ['executed', null], 'the preview stays executed, not rejected');
    assert.equal(await runs(race, itemId), 1, 'the operation ran once');
  });
}

/** Two batches approving the same two previews in opposite orders: both lock them in id order, no deadlock. */
async function crossedBatches() {
  await withRace('ai-approve-batches', async (race) => {
    const { userId, itemId, previewIds } = await seedPreview(race, 2);
    const [low, high] = [...previewIds].sort();
    const a = await race.open('batch A (high, low)');
    const b = await race.open('batch B (low, high)');
    const context = (manager: any) => ({ tenantId: race.tenantId, userId, manager, conversationId: null });

    const aLocked = race.gate(a, { label: 'lock a preview', when: 'after', match: sql.lockOn('ai_mutation_previews') });
    const aWork = race.start(a, (manager) => previewService().executePreviewsWithFollowUps(context(manager) as any, [high, low]));
    assert.equal(await progress(aWork, { party: a, gate: aLocked }), 'gated', 'harness: A must pause holding a preview');
    const bWork = race.start(b, (manager) => previewService().executePreviewsWithFollowUps(context(manager) as any, [low, high]));
    await progress(bWork, { party: b });
    aLocked.release();
    const [aDone, bDone] = await Promise.all([settle(aWork), settle(bWork)]);
    assert.notEqual(pgCode((aDone as any).error) ?? pgCode((bDone as any).error), '40P01', 'a batch ended in a deadlock (40P01)');
    assertSucceeded(aDone, 'batch A');
    assertSucceeded(bDone, 'batch B');
    assert.deepEqual((aDone as any).value.results.map((r: any) => r.preview_id), [high, low], 'A ran its previews in the order given');
    assert.ok((bDone as any).value.results.every((r: any) => r.status === 'executed'), 'B finds both executed');
    assert.equal(await runs(race, itemId), 2, 'each preview ran once');
  });
}

/** An approval whose line is held past the lock timeout: the preview stays pending, approvable again. */
async function approvalMeetsHeldLine() {
  await withRace('ai-approve-busy', async (race) => {
    const { userId, itemId, previewId } = await seedPreview(race);
    const holder = await race.open('bulk operation (holds the line)');
    const approver = await race.open('approval');
    const context = (manager: any) => ({ tenantId: race.tenantId, userId, manager, conversationId: null });

    const lineHeld = race.gate(holder, { label: 'lock the line', when: 'after', match: sql.lockOn('spend_items') });
    const holderWork = race.start(holder, (manager) => lockBudgetLine(manager, 'opex', race.tenantId, itemId));
    assert.equal(await progress(holderWork, { party: holder, gate: lineHeld }), 'gated', 'harness: the holder must pause holding the line');

    const first = await settle(race.start(approver, async (manager) => {
      await manager.query(`SET LOCAL lock_timeout = '300ms'`);
      return previewService().executePreview(context(manager) as any, previewId);
    }));
    assertSucceeded(first, 'the first approval (answered, not thrown)');
    assert.equal((first as any).value.status, 'pending', 'a lock timeout leaves the preview pending');
    assert.match(String((first as any).value.error_message), /busy with another operation/, 'with a plain message');
    assert.doesNotMatch(String((first as any).value.error_message), /lock|timeout|canceling/i, 'never the database\'s message');
    assert.equal(await runs(race, itemId), 0, 'nothing ran');

    lineHeld.release();
    assertSucceeded(await settle(holderWork), 'the holder');
    const second = await settle(race.start(approver, (manager) => previewService().executePreview(context(manager) as any, previewId)));
    assertSucceeded(second, 'the second approval');
    assert.equal((second as any).value.status, 'executed', 'approved again, it runs');
    assert.equal((second as any).value.error_message, null, 'the message is gone');
    assert.equal(await runs(race, itemId), 1, 'the operation ran once');
  });
}

void runRaceSpecs('AI preview approval races', [
  ['Annexe A #24: two approvals of one AI preview run it once (3B)', doubleApproval],
  ['Annexe A #24: an approval and a rejection of one AI preview at once (3B)', approvalVersusRejection],
  ['two batches approving the same previews in opposite orders, no deadlock (3B review)', crossedBatches],
  ['an approval whose line is held past the lock timeout stays approvable (3B review)', approvalMeetsHeldLine],
]);
