import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';

// A sub-location removed (lot K2b), by the site's Sub-locations table or by the assistant's card,
// leaves its assets without a sub-location: each asset's History tab shows that change as its page
// shows a sub-location emptied by hand (the field, before and after), by the author of the gesture,
// "by Kad" for the card. The assets are read, cleared and their entries written in one statement each,
// whatever their number (one and twelve here).

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.SETTINGS_ENCRYPTION_SECRET ||= process.env.AI_SETTINGS_ENCRYPTION_SECRET || 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'location-sub-item-detach-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

const PERMISSIONS = { infrastructure: 'admin', locations: 'admin', ai_chat: 'member' } as const;

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for location-sub-item-detach-history.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiMutationPreviewService } = require('../../ai/ai-mutation-preview.service');
  const { AiPolicyService } = require('../../ai/ai-policy.service');
  const { RecordHistoryService } = require('../../audit/record-history.service');
  const { LocationsService } = require('../locations.service');
  const { AssetsCrudService } = require('../../assets/services/assets-crud.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  app.get(AiPolicyService).assertSurfaceAccess = async () => undefined;
  const previews = app.get(AiMutationPreviewService);
  const locations = app.get(LocationsService);
  const assets = app.get(AssetsCrudService);
  const runner = app.get(DataSource).createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  // The statements of the gesture: clearing the assets and writing their History entries.
  const statements: string[] = [];
  const query = runner.query.bind(runner);
  (runner as any).query = (sql: string, ...rest: unknown[]) => {
    statements.push(sql);
    return query(sql, ...(rest as []));
  };
  const failures: string[] = [];
  let passed = 0;
  try {
    const tenantId = randomUUID();
    const slug = `sub-item-detach-${tenantId.slice(0, 8)}`;
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, slug, slug],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const insertId = async (sql: string, params: unknown[]) => (await runner.query(`${sql} RETURNING id`, params))[0].id as string;
    const roleId = await insertId(`INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, 'Writer', 'Writer')`, [tenantId]);
    for (const [resource, level] of Object.entries(PERMISSIONS)) {
      await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, roleId, resource, level]);
    }
    const writer = await insertId(
      `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, 'Claude', 'Writer', $3, 'enabled')`,
      [tenantId, `writer-${tenantId.slice(0, 8)}@example.test`, roleId],
    );
    await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`, [tenantId, writer, roleId]);
    const ctx = { tenantId, userId: writer, isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const, manager: runner.manager, conversationId: null };
    const history = (assetId: string) => new RecordHistoryService().list(
      { tenantId, userId: writer, isAdmin: false, permissions: PERMISSIONS, manager: runner.manager }, 'assets', assetId, { limit: 50 },
    );
    /** The History entries of an asset that change its sub-location, as the tab shows them. */
    const subLocationEntries = async (assetId: string) => (await history(assetId)).items
      .filter((item: any) => item.changes.some((change: any) => change.field === 'sub_location_id'))
      .map((item: any) => ({
        actor: item.actor.kind,
        fields: item.changes.map((change: any) => change.field),
        change: item.changes.find((change: any) => change.field === 'sub_location_id'),
      }));

    let site = 0;
    const seed = async (count: number) => {
      const locationId = await insertId(`INSERT INTO locations (tenant_id, name, hosting_type) VALUES ($1, $2, 'on_premise')`, [tenantId, `Site ${++site}`]);
      const subId = await insertId(`INSERT INTO location_sub_items (tenant_id, location_id, name, display_order) VALUES ($1, $2, 'Salle A', 0)`, [tenantId, locationId]);
      const ids: string[] = [];
      for (let i = 0; i < count; i += 1) {
        ids.push(await insertId(
          `INSERT INTO assets (tenant_id, name, kind, environment, location_id, sub_location_id) VALUES ($1, $2, 'server', 'prod', $3, $4)`,
          [tenantId, `srv-${site}-${i}`, locationId, subId],
        ));
      }
      return { locationId, subId, ids };
    };

    // The reference: a sub-location emptied by hand on the asset's page.
    const reference = await seed(1);
    await assets.update(reference.ids[0], { sub_location_id: null } as any, tenantId, writer, { manager: runner.manager });
    const [byHand] = await subLocationEntries(reference.ids[0]);
    assert.ok(byHand, 'the asset page writes an entry');

    const gestures: Array<{ name: string; actor: string; play: (seeded: { locationId: string; subId: string }) => Promise<void> }> = [
      {
        name: 'the Sub-locations table',
        actor: 'user',
        play: async ({ locationId, subId }) => {
          await locations.deleteSubItem(locationId, subId, writer, { manager: runner.manager });
        },
      },
      {
        name: "the assistant's card",
        actor: 'assistant',
        play: async ({ locationId }) => {
          const preview = await previews.createPreview(ctx, 'update_entity_relations', {
            entity_type: 'locations', ref: locationId, relation: 'sub_locations', remove: [{ name: 'Salle A' }],
          });
          statements.length = 0;
          const executed = await previews.executePreview(ctx, preview.preview_id);
          assert.equal(executed.status, 'executed', executed.error_message ?? '');
        },
      },
    ];
    const inserts = new Map<string, number>();
    for (const gesture of gestures) {
      for (const count of [1, 12]) {
        const cell = `${gesture.name}, ${count} asset${count > 1 ? 's' : ''}`;
        await runner.query('SAVEPOINT cell');
        try {
          const seeded = await seed(count);
          statements.length = 0;
          await gesture.play(seeded);
          const left = await runner.query(`SELECT count(*)::int AS n FROM assets WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND sub_location_id IS NULL`, [tenantId, seeded.ids]);
          assert.equal(left[0].n, count, 'every asset is left without a sub-location');
          for (const id of seeded.ids) {
            const entries = await subLocationEntries(id);
            assert.equal(entries.length, 1, 'one History entry on the asset');
            assert.equal(entries[0].actor, gesture.actor, 'by the author of the gesture');
            assert.deepEqual(entries[0].fields, byHand.fields, 'the fields of the entry the asset page writes');
            assert.equal(entries[0].change.after, null, 'emptied');
            assert.equal(typeof entries[0].change.before, typeof byHand.change.before, 'the sub-location it had, as the page names it');
          }
          const reads = statements.filter((sql) => /SELECT \* FROM assets WHERE tenant_id = \$2 AND sub_location_id = \$1/.test(sql));
          const clears = statements.filter((sql) => /UPDATE assets SET sub_location_id = NULL/.test(sql));
          const entriesWritten = statements.filter((sql) => /INSERT INTO "audit_log"/.test(sql));
          assert.equal(reads.length, 1, 'one statement reads the assets');
          assert.equal(clears.length, 1, 'one statement clears the assets');
          // The entries in one statement: as many audit inserts for twelve assets as for one.
          const one = inserts.get(gesture.name);
          if (one == null) inserts.set(gesture.name, entriesWritten.length);
          else assert.equal(entriesWritten.length, one, `as many audit inserts for ${count} assets as for one`);
          passed += 1;
          console.log(`  ${cell}: OK`);
        } catch (error: any) {
          failures.push(`${cell}: ${String(error?.stack ?? error).split('\n').slice(0, 12).join('\n')}`);
          console.log(`  ${cell}: FAILED`);
        }
        await runner.query('ROLLBACK TO SAVEPOINT cell');
      }
    }
  } finally {
    (runner as any).query = query;
    await runner.rollbackTransaction().catch(() => undefined);
    await runner.release();
    await app.close();
  }
  console.log(`location-sub-item-detach-history: ${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error(failures.join('\n\n'));
    process.exit(1);
  }
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
