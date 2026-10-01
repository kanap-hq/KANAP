import { AiMutationPreviewService } from '../ai-mutation-preview.service';
import { seedUser } from '../../spend/__tests__/cost-center.fixtures';
import { seedItem } from '../../spend/__tests__/round-inputs.fixtures';
import { assert, assertSucceeded, progress, runRaceSpecs, settle, sql, withRace } from '../../spend/__tests__/race-harness';

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
// The operation here is a stand-in that adds one link to a line, so each run
// can be counted.

const TOOL = 'race_counted_write';

function previewService() {
  const operation = {
    toolName: TOOL,
    businessResource: 'opex',
    executePreview: async (context: any, preview: any) => {
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

async function seedPreview(race: Parameters<Parameters<typeof withRace>[1]>[0]) {
  return race.seedWith(async (runner) => {
    const userId = await seedUser(runner, race.tenantId, 'approver@example.com');
    const itemId = await seedItem(runner, 'opex', race.tenantId, 1);
    const [preview] = await runner.query(
      `INSERT INTO ai_mutation_previews (tenant_id, user_id, tool_name, target_entity_type, target_entity_id, mutation_input, current_values, status, expires_at)
       VALUES ($1, $2, $3, 'spend_items', $4, '{}'::jsonb, '{}'::jsonb, 'pending', now() + interval '1 hour') RETURNING id`,
      [race.tenantId, userId, TOOL, itemId],
    );
    return { userId, itemId, previewId: preview.id as string };
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

void runRaceSpecs('AI preview approval races', [
  ['Annexe A #24: two approvals of one AI preview run it once (3B)', doubleApproval],
  ['Annexe A #24: an approval and a rejection of one AI preview at once (3B)', approvalVersusRejection],
]);
