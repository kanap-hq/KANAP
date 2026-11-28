// @database-spec
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, EntityManager } from 'typeorm';

// The assistant's approval of a relation card takes the lock the screen takes for the same gesture,
// on the same row, before it reads the links (lot K2b): a person who links A on the screen while a
// card "link A", asked before, is approved makes the card wait, then find the links changed since
// its preview. It is refused (409) and leaves no audit row; the screen's row is the only one.
// Two connections: the screen's transaction holds its lock while the approval starts. The last two
// cells place an asset in a sub-location a card removes, before and during the approval.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.SETTINGS_ENCRYPTION_SECRET ||= process.env.AI_SETTINGS_ENCRYPTION_SECRET || 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-relation-concurrency-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

const FULL = {
  applications: 'admin', infrastructure: 'admin', budget: 'admin', contracts: 'admin', portfolio_projects: 'admin',
  portfolio_requests: 'admin', locations: 'admin', ai_chat: 'member',
} as const;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-relation-concurrency.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiRelationMutationSupportService } = require('../mutation/ai-relation-mutation-support.service');
  const { ApplicationsRelationsService } = require('../../applications/services/applications-relations.service');
  const { ContractsService } = require('../../contracts/contracts.service');
  const { purgeTenantTables } = require('../../admin/tenants/tenant-data-purge');
  const { TENANT_PURGE_TABLES } = require('../../admin/tenants/tenant-purge.inventory');
  const { AiPolicyService } = require('../ai-policy.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  app.get(AiPolicyService).assertSurfaceAccess = async () => undefined;
  const dataSource = app.get(DataSource);
  const assistant = app.get(AiRelationMutationSupportService);
  const tabs = app.get(ApplicationsRelationsService);
  const contracts = app.get(ContractsService);
  const tenantId = randomUUID();

  /** One transaction of the tenant on its own connection, committed when `fn` resolves. */
  const inTenant = async <T>(fn: (manager: EntityManager) => Promise<T>): Promise<T> => {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      const value = await fn(runner.manager);
      await runner.commitTransaction();
      return value;
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  };
  const id = async (manager: EntityManager, sql: string, params: unknown[]): Promise<string> => (await manager.query(`${sql} RETURNING id`, params))[0].id;

  try {
    await dataSource.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `ai-relation-race-${tenantId.slice(0, 8)}`, `ai-relation-race-${tenantId.slice(0, 8)}`],
    );
    const seed = await inTenant(async (m) => {
      const roleId = await id(m, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, 'Writer', 'Writer')`, [tenantId]);
      for (const [resource, level] of Object.entries(FULL)) {
        await m.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, roleId, resource, level]);
      }
      const writer = await id(m,
        `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, 'Claude', 'Writer', $3, 'enabled')`,
        [tenantId, `race-${tenantId.slice(0, 8)}@example.test`, roleId]);
      await m.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`, [tenantId, writer, roleId]);
      const company = await id(m, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Corderie', 'FR', 'Roscoff')`, [tenantId]);
      const supplier = await id(m, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Fournisseur')`, [tenantId]);
      return { writer, company, supplier };
    });
    const ctx = (manager: EntityManager) => ({
      tenantId, userId: seed.writer, isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const, manager, conversationId: null,
    });

    /** The card as the approval reads it: prepared in its own transaction, before the screen's gesture. */
    const card = async (input: Record<string, unknown>) => {
      const prepared: any = await inTenant((m) => assistant.prepareUpdatePreview(ctx(m), input));
      return {
        id: randomUUID(),
        target_entity_type: prepared.targetEntityType,
        target_entity_id: prepared.targetEntityId,
        mutation_input: prepared.mutationInput,
        current_values: prepared.currentValues,
      };
    };

    /**
     * The screen's gesture in a transaction that holds its lock while the approval starts on another
     * connection; the approval must still be waiting when the screen commits. Returns its outcome.
     */
    const race = async (screen: (m: EntityManager) => Promise<unknown>, preview: unknown) => {
      let settled = false;
      let approval: Promise<{ ok: true } | { ok: false; error: any }> | null = null;
      await inTenant(async (m) => {
        await screen(m);
        approval = inTenant((other) => assistant.executePreview(ctx(other), preview)).then(
          () => ({ ok: true as const }),
          (error: any) => ({ ok: false as const, error }),
        );
        approval.then(() => { settled = true; });
        await new Promise((resolve) => setTimeout(resolve, 400));
        assert.equal(settled, false, 'the approval waits for the screen to commit');
      });
      return approval as unknown as Promise<{ ok: true } | { ok: false; error: any }>;
    };

    const assistantRows = () => inTenant((m) => m.query(`SELECT table_name FROM audit_log WHERE tenant_id = $1 AND source = 'ai_chat'`, [tenantId]));
    const line = async (number: number) => inTenant((m) => id(m,
      `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, nature) VALUES ($1, $2, 'EUR', '2026-01-01', $3, 'opex')`,
      [tenantId, `Ligne ${number}`, number]));
    const refused = (cell: string, outcome: { ok: boolean; error?: any }) => {
      assert.equal(outcome.ok, false, `${cell}: the card is refused`);
      assert.equal(outcome.error?.getStatus?.(), 409, `${cell}: a conflict (${outcome.error?.message})`);
      assert.match(String(outcome.error?.message), /changed after the preview/, `${cell}: the links changed since the preview`);
    };

    // A toggle of the application's Relations tab (`setOwnedLink`, the application row locked).
    {
      const cell = 'applications.budget_lines';
      const appId = await inTenant((m) => id(m, `INSERT INTO applications (tenant_id, name, sequential_id, status) VALUES ($1, 'Caisse', 'APP-1', 'enabled')`, [tenantId]));
      const lineA = await line(1);
      const preview = await card({ entity_type: 'applications', ref: 'APP-1', relation: 'budget_lines', add: ['BL-1'] });
      const outcome = await race((m) => tabs.setLink('budget_lines', appId, lineA, true, {
        manager: m, tenantId, userId: seed.writer, access: { budget_lines: true }, writes: {}, scopes: {}, incidentViewer: undefined,
      }), preview);
      refused(cell, outcome);
      const links = await inTenant((m) => m.query(`SELECT 1 FROM application_spend_items WHERE tenant_id = $1 AND application_id = $2`, [tenantId, appId]));
      assert.equal(links.length, 1, `${cell}: one link`);
      assert.deepEqual(await assistantRows(), [], `${cell}: no audit row by the assistant`);
      console.log(`  ${cell}: OK`);
    }

    // The contract's Budget tab (`replaceContractRelations`, the contract row locked).
    {
      const cell = 'contracts.budget_lines';
      const contractId = await inTenant((m) => id(m,
        `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, 'Contrat', $2, $3, '2026-01-01')`,
        [tenantId, seed.company, seed.supplier]));
      const lineA = await line(2);
      const preview = await card({ entity_type: 'contracts', ref: 'Contrat', relation: 'budget_lines', add: ['BL-2'] });
      const outcome = await race((m) => contracts.replaceRelations(contractId, 'budget_lines', [lineA], seed.writer, { manager: m }), preview);
      refused(cell, outcome);
      const links = await inTenant((m) => m.query(`SELECT 1 FROM contract_spend_items WHERE tenant_id = $1 AND contract_id = $2`, [tenantId, contractId]));
      assert.equal(links.length, 1, `${cell}: one link`);
      assert.deepEqual(await assistantRows(), [], `${cell}: no audit row by the assistant`);
      console.log(`  ${cell}: OK`);
    }
    // A card that removes a site's sub-location names the assets it leaves without one. Placing an
    // asset in the sub-location checks the foreign key with a KEY SHARE lock on its row; the
    // approval locks the removed sub-locations FOR UPDATE before it reads their assets.
    const site = await inTenant((m) => id(m,
      `INSERT INTO locations (tenant_id, location_reference, name, hosting_type) VALUES ($1, 'LOC-1', 'Brest', 'cloud')`, [tenantId]));
    const room = (name: string) => inTenant((m) => id(m, `INSERT INTO location_sub_items (tenant_id, location_id, name) VALUES ($1, $2, $3)`, [tenantId, site, name]));
    const server = (name: string) => inTenant((m) => id(m,
      `INSERT INTO assets (tenant_id, name, kind, environment, location_id) VALUES ($1, $2, 'server', 'prod', $3)`, [tenantId, name, site]));
    const place = (m: EntityManager, assetId: string, roomId: string) => m.query(
      `UPDATE assets SET sub_location_id = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, assetId, roomId]);
    const rooms = (roomId: string) => inTenant(async (m) => (await m.query(`SELECT 1 FROM location_sub_items WHERE tenant_id = $1 AND id = $2`, [tenantId, roomId])).length);

    // The asset is placed first: the approval waits, then reads it and refuses (the card named none).
    {
      const cell = 'locations.sub_locations, asset placed before the approval';
      const roomId = await room('Salle 1');
      const assetId = await server('srv-1');
      const preview = await card({ entity_type: 'locations', ref: 'LOC-1', relation: 'sub_locations', remove: [{ name: 'Salle 1' }] });
      const outcome = await race((m) => place(m, assetId, roomId), preview);
      refused(cell, outcome);
      assert.equal(await rooms(roomId), 1, `${cell}: the sub-location stays`);
      assert.deepEqual(await assistantRows(), [], `${cell}: no audit row by the assistant`);
      console.log(`  ${cell}: OK`);
    }

    // The approval runs first: the placement waits, then finds the sub-location gone.
    {
      const cell = 'locations.sub_locations, asset placed during the approval';
      const roomId = await room('Salle 2');
      const assetId = await server('srv-2');
      const preview = await card({ entity_type: 'locations', ref: 'LOC-1', relation: 'sub_locations', remove: [{ name: 'Salle 2' }] });
      let settled = false;
      let placement: Promise<{ ok: boolean; error?: any }> | null = null;
      await inTenant(async (m) => {
        await assistant.executePreview(ctx(m), preview);
        placement = inTenant((other) => place(other, assetId, roomId)).then(() => ({ ok: true }), (error: any) => ({ ok: false, error }));
        placement.then(() => { settled = true; });
        await new Promise((resolve) => setTimeout(resolve, 400));
        assert.equal(settled, false, `${cell}: the placement waits for the approval to commit`);
      });
      const outcome = await (placement as unknown as Promise<{ ok: boolean; error?: any }>);
      assert.equal(outcome.ok, false, `${cell}: the placement fails`);
      assert.equal(outcome.error?.code, '23503', `${cell}: the sub-location is gone (${outcome.error?.message})`);
      assert.equal(await rooms(roomId), 0, `${cell}: the sub-location is removed`);
      const [asset] = await inTenant((m) => m.query(`SELECT sub_location_id FROM assets WHERE tenant_id = $1 AND id = $2`, [tenantId, assetId]));
      assert.equal(asset.sub_location_id, null, `${cell}: the asset has no sub-location`);
      console.log(`  ${cell}: OK`);
    }
    console.log('ai-relation-concurrency.integration.spec: ok');
  } finally {
    await inTenant((m) => purgeTenantTables(m, TENANT_PURGE_TABLES)).catch((error) => console.error(`could not purge ${tenantId}:`, error));
    await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]).catch((error) => console.error(`could not delete ${tenantId}:`, error));
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
