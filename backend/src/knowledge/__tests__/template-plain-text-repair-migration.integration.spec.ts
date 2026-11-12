import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { markdownToSearchText } from '../../common/markdown-search-text';
import { seedManagedDocsKnowledgeAssets } from '../integrated-document-seed';
import { TemplatePlainTextRepair1856200000000 } from '../../migrations/1856200000000-template-plain-text-repair';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

// Migration 1856200000000 against a real database, in a transaction that is rolled back: two tenants
// seeded as before the fix of the template seed (the templates of the Templates library with an empty
// content_plain, so their body is not indexed), one of them with a template edited since (its plain
// text derived by the save) and a document of another library with an empty plain text. The first
// up() derives the plain text of the seeded templates of both tenants, which indexes their body and
// their search entry, logs one count per tenant and leaves the edited template and the other library
// alone; a second up() updates no row.

const migration = new TemplatePlainTextRepair1856200000000();

type Seeded = { tenantId: string; edited: string; otherLibrary: string; dirty: string[] };

async function asTenant<T>(runner: QueryRunner, tenantId: string, fn: () => Promise<T>): Promise<T> {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  try {
    return await fn();
  } finally {
    await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
  }
}

async function seedDirtyTenant(runner: QueryRunner, tag: string, withEditedTemplate: boolean): Promise<Seeded> {
  const tenantId = await seedTenant(runner, `tpl-plain-${tag}`);
  await seedManagedDocsKnowledgeAssets(runner, tenantId);
  return asTenant(runner, tenantId, async () => {
    // What the seed wrote before its fix: no plain text, so no indexed body.
    const dirtyRows: Array<{ id: string }> = await runner.query(
      `WITH dirty AS (
         UPDATE documents d SET content_plain = ''
           FROM document_libraries dl
          WHERE dl.id = d.library_id AND dl.tenant_id = d.tenant_id
            AND dl.slug = 'templates' AND d.tenant_id = $1 AND d.content_markdown <> ''
         RETURNING d.id
       )
       SELECT id FROM dirty ORDER BY id`,
      [tenantId],
    );
    let edited = '';
    if (withEditedTemplate) {
      edited = dirtyRows.pop()!.id;
      const body = `## Constat\n\nLe modèle adapté parle de la faisselle ${tag}.`;
      await runner.query(
        `UPDATE documents SET content_markdown = $2, content_plain = $3 WHERE id = $1`,
        [edited, body, markdownToSearchText(body)],
      );
    }
    const libraryId = randomUUID();
    await runner.query(
      `INSERT INTO document_libraries (id, tenant_id, name, slug, is_system, display_order, created_at, updated_at)
       VALUES ($1, $2, 'Other', 'other-${tag}', false, 5, now(), now())`,
      [libraryId, tenantId],
    );
    const otherLibrary = randomUUID();
    await runner.query(
      `INSERT INTO documents (
         id, tenant_id, item_number, title, content_markdown, content_plain, library_id,
         status, revision, current_version_number, created_at, updated_at
       )
       VALUES ($1, $2, 900, 'Hors modèles', '## Tomme de brebis', '', $3, 'published', 1, 0, now(), now())`,
      [otherLibrary, tenantId, libraryId],
    );
    return { tenantId, edited, otherLibrary, dirty: dirtyRows.map((row) => row.id) };
  });
}

type Row = { id: string; ctid: string; content_markdown: string; content_plain: string; indexed: boolean; entry_indexed: boolean };

async function rows(runner: QueryRunner, tenantId: string): Promise<Map<string, Row>> {
  return asTenant(runner, tenantId, async () => {
    const result: Row[] = await runner.query(
      `SELECT d.id, d.ctid::text AS ctid, d.content_markdown, d.content_plain,
              COALESCE(d.search_vector @@ plainto_tsquery('kanap_en', split_part(d.content_plain, ' ', 2)), false) AS indexed,
              COALESCE(si.search_vector @@ plainto_tsquery('kanap_en', split_part(d.content_plain, ' ', 2)), false) AS entry_indexed
         FROM documents d
         LEFT JOIN search_index si
           ON si.tenant_id = d.tenant_id AND si.entity_type = 'documents' AND si.entity_id = d.id
        WHERE d.tenant_id = $1`,
      [tenantId],
    );
    return new Map(result.map((row) => [row.id, row]));
  });
}

async function captureLog(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines;
}

async function testRepairsSeededTemplatesTenantByTenant() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seedDirtyTenant(runner, 'a', true);
    const b = await seedDirtyTenant(runner, 'b', false);
    assert.ok(a.dirty.length >= 1, 'tenant a has a seeded template with a body left unindexed');
    assert.ok(b.dirty.length >= 2, 'tenant b has the seeded templates with a body left unindexed');

    const before = new Map<string, Map<string, Row>>();
    for (const seeded of [a, b]) {
      const state = await rows(runner, seeded.tenantId);
      before.set(seeded.tenantId, state);
      for (const id of seeded.dirty) assert.equal(state.get(id)!.content_plain, '', `seeded: ${id} has no plain text`);
    }

    await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
    const firstLog = await captureLog(() => migration.up(runner));
    const [setting] = await runner.query(`SELECT current_setting('app.current_tenant', true) AS value`);
    assert.equal(setting.value, '', 'the tenant setting is restored');

    for (const seeded of [a, b]) {
      const after = await rows(runner, seeded.tenantId);
      for (const id of seeded.dirty) {
        const row = after.get(id)!;
        assert.equal(row.content_plain, markdownToSearchText(row.content_markdown), `repaired: plain text of ${id}`);
        assert.notEqual(row.content_plain, '');
        assert.equal(row.indexed, true, `repaired: body of ${id} indexed`);
        assert.equal(row.entry_indexed, true, `repaired: search entry of ${id}`);
      }
      const previous = before.get(seeded.tenantId)!;
      assert.equal(after.get(seeded.otherLibrary)!.content_plain, '', 'a document of another library is left alone');
      assert.equal(after.get(seeded.otherLibrary)!.ctid, previous.get(seeded.otherLibrary)!.ctid);
      if (seeded.edited) {
        assert.equal(after.get(seeded.edited)!.ctid, previous.get(seeded.edited)!.ctid, 'an edited template is not updated');
      }
      const line = firstLog.find((entry) => entry.includes(`tenant ${seeded.tenantId}:`));
      assert.ok(line, `a log line for tenant ${seeded.tenantId}`);
      assert.match(line!, new RegExp(`: ${seeded.dirty.length} template\\(s\\) repaired$`));
    }

    const snapshot = new Map<string, Map<string, Row>>();
    for (const seeded of [a, b]) snapshot.set(seeded.tenantId, await rows(runner, seeded.tenantId));
    const secondLog = await captureLog(() => migration.up(runner));
    for (const seeded of [a, b]) {
      for (const [id, row] of await rows(runner, seeded.tenantId)) {
        assert.equal(row.ctid, snapshot.get(seeded.tenantId)!.get(id)!.ctid, `second run: ${id} is not updated`);
      }
      assert.equal(secondLog.some((entry) => entry.includes(`tenant ${seeded.tenantId}:`)), false, 'second run: nothing to log');
    }
  });
}

async function testDownChangesNothing() {
  await inRolledBackTransaction(async (runner) => {
    const seeded = await seedDirtyTenant(runner, 'down', false);
    await migration.up(runner);
    const repaired = await rows(runner, seeded.tenantId);
    await migration.down(runner);
    const after = await rows(runner, seeded.tenantId);
    for (const id of seeded.dirty) assert.equal(after.get(id)!.ctid, repaired.get(id)!.ctid, 'down() keeps the plain text');
  });
}

void runSpecs('template-plain-text-repair-migration.integration.spec', [
  ['testRepairsSeededTemplatesTenantByTenant', testRepairsSeededTemplatesTenantByTenant],
  ['testDownChangesNothing', testDownChangesNothing],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
