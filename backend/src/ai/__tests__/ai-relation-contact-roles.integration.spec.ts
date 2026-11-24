import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// The roles of the contacts the assistant links (`update_entity_relations`, lot K2b):
// - a contact of a supplier, a contract or a budget line (OPEX and CAPEX) takes one of the four
//   roles, said by its code or by its word in any of the four languages, the contact named by the
//   keys the model writes (`contact`, a CTCT-n reference). Without a role, or with another word, the
//   card is not proposed and the refusal lists the four roles (the screens ask the role in their
//   dialog, with nothing chosen beforehand);
// - an application's or an asset's support contact takes any text, or none, as their Support panel;
// - a card stored without a role refuses at its approval in words, never with the database's text;
// - the other relations with a required value refuse it before the card (owner role, server role).

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-relation-contact-roles-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

const FULL = {
  applications: 'admin', infrastructure: 'admin', budget: 'admin', contracts: 'admin', contacts: 'admin',
  suppliers: 'admin', companies: 'admin', locations: 'admin', users: 'admin', ai_chat: 'member',
} as const;

const PG_TEXT = /violates|null value|invalid input value/i;
const FOUR_ROLES = /commercial, technical, support or other/;

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-relation-contact-roles.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiMutationPreviewService } = require('../ai-mutation-preview.service');
  const { AiPolicyService } = require('../ai-policy.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  app.get(AiPolicyService).assertSurfaceAccess = async () => undefined;
  const previews = app.get(AiMutationPreviewService);
  const runner = app.get(DataSource).createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  const failures: string[] = [];
  let passed = 0;
  const cell = async (name: string, fn: () => Promise<void>) => {
    await runner.query('SAVEPOINT cell');
    try {
      await fn();
      passed += 1;
      console.log(`  ${name}: OK`);
    } catch (error: any) {
      failures.push(`${name}: ${String(error?.stack ?? error).split('\n').slice(0, 12).join('\n')}`);
      console.log(`  ${name}: FAILED`);
    }
    await runner.query('ROLLBACK TO SAVEPOINT cell');
  };
  try {
    const tenantId = randomUUID();
    const slug = `ai-relation-roles-${tenantId.slice(0, 8)}`;
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, slug, slug],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const roleId = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, 'Writer', 'Writer')`, [tenantId]);
    for (const [resource, level] of Object.entries(FULL)) {
      await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, roleId, resource, level]);
    }
    const writer = await insertId(runner,
      `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, 'Claude', 'Writer', $3, 'enabled')`,
      [tenantId, `writer-${tenantId.slice(0, 8)}@example.test`, roleId]);
    await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`, [tenantId, writer, roleId]);
    const ctx = { tenantId, userId: writer, isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const, manager: runner.manager, conversationId: null };

    const contactId = await insertId(runner, `INSERT INTO contacts (tenant_id, first_name, last_name, email) VALUES ($1, 'Maëlle', 'Kerbrat', 'maelle@example.test')`, [tenantId]);
    const [{ item_number: contactNumber }] = await runner.query(`SELECT item_number FROM contacts WHERE id = $1`, [contactId]);
    const contactRef = `CTCT-${contactNumber}`;
    const companyId = await insertId(runner, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Cidrerie', 'FR', 'Quimper')`, [tenantId]);
    const supplierId = await insertId(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Fournisseur des rôles')`, [tenantId]);
    const [{ item_number: supplierNumber }] = await runner.query(`SELECT item_number FROM suppliers WHERE id = $1`, [supplierId]);
    const contractId = await insertId(runner,
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, 'Contrat des rôles', $2, $3, '2026-01-01')`, [tenantId, companyId, supplierId]);
    const [{ item_number: contractNumber }] = await runner.query(`SELECT item_number FROM contracts WHERE id = $1`, [contractId]);
    const lineOf = async (nature: 'opex' | 'capex', number: number) => insertId(runner,
      `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, nature) VALUES ($1, $2, 'EUR', '2026-01-01', $3, $4)`,
      [tenantId, `Ligne ${nature}`, number, nature]);
    await lineOf('opex', 9101);
    await lineOf('capex', 9102);
    const appId = await insertId(runner, `INSERT INTO applications (tenant_id, name, sequential_id, status) VALUES ($1, 'Caisse', 'APP-9101', 'enabled')`, [tenantId]);
    await insertId(runner, `INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, 'prod')`, [tenantId, appId]);
    await insertId(runner, `INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, 'srv-roles', 'server', 'prod')`, [tenantId]);

    const refused = async (input: Record<string, unknown>): Promise<string> => {
      await runner.query('SAVEPOINT refusal');
      try {
        await previews.createPreview(ctx, 'update_entity_relations', input);
      } catch (error: any) {
        await runner.query('ROLLBACK TO SAVEPOINT refusal');
        return String(error?.message ?? error);
      }
      await runner.query('ROLLBACK TO SAVEPOINT refusal');
      return '';
    };
    const approve = async (input: Record<string, unknown>) => {
      const preview = await previews.createPreview(ctx, 'update_entity_relations', input);
      return previews.executePreview(ctx, preview.preview_id);
    };

    const roleFamilies = [
      { name: 'contract', entity: 'contracts', ref: `CTR-${contractNumber}`, relation: 'contacts', table: 'contract_contacts', column: 'contract_id', id: contractId },
      { name: 'OPEX line', entity: 'budget_lines', ref: 'BL-9101', relation: 'contacts', table: 'spend_item_contacts', column: 'spend_item_id' },
      { name: 'CAPEX line', entity: 'budget_lines', ref: 'BL-9102', relation: 'contacts', table: 'spend_item_contacts', column: 'spend_item_id' },
      { name: 'supplier', entity: 'suppliers', ref: `SUP-${supplierNumber}`, relation: 'contacts', table: 'supplier_contacts', column: 'supplier_id', id: supplierId },
    ];
    for (const family of roleFamilies) {
      const base = { entity_type: family.entity, ref: family.ref, relation: family.relation };
      await cell(`${family.name}: a contact without a role is refused before the card, with the four roles`, async () => {
        for (const item of [{ contact: contactRef }, contactRef, { contact_ref: 'maelle@example.test' }]) {
          const refusal = await refused({ ...base, add: [item] });
          assert.match(refusal, FOUR_ROLES, `${JSON.stringify(item)}: the refusal lists the roles (${refusal})`);
          assert.doesNotMatch(refusal, PG_TEXT);
        }
      });
      await cell(`${family.name}: an unknown role is refused before the card`, async () => {
        const refusal = await refused({ ...base, add: [{ contact: contactRef, role: 'Responsable' }] });
        assert.match(refusal, /"Responsable" is not a contact role/);
        assert.match(refusal, FOUR_ROLES);
      });
      await cell(`${family.name}: the role said by its word in French, the contact by its reference`, async () => {
        const executed = await approve({ ...base, add: [{ contact: contactRef, role: 'Technique' }] });
        assert.equal(executed.status, 'executed', executed.error_message ?? '');
        const rows = await runner.query(`SELECT l.role::text AS role FROM ${family.table} l JOIN ${family.entity === 'budget_lines' ? 'spend_items' : family.entity} r ON r.id = l.${family.column}
          WHERE l.tenant_id = $1 AND l.contact_id = $2 AND ${family.entity === 'budget_lines' ? `r.item_number = ${family.ref.slice(3)}` : `r.id = '${family.id}'`}`, [tenantId, contactId]);
        assert.deepEqual(rows, [{ role: 'technical' }]);
      });
      await cell(`${family.name}: the roles in German and Spanish, and a role given as an object`, async () => {
        for (const [role, code] of [['Vertrieb', 'commercial'], ['Soporte', 'support'], [{ code: 'other' }, 'other']] as const) {
          const preview = await previews.createPreview(ctx, 'update_entity_relations', { ...base, add: [{ contact: { ref: contactRef }, role }] });
          const to = (preview.changes?.contacts?.relation_items?.to ?? []) as Array<{ name: string; role: { code: string } | null }>;
          assert.ok(to.some((item) => item.role?.code === code), `${JSON.stringify(role)} reads as ${code}: ${JSON.stringify(to)}`);
        }
      });
    }

    await cell('contract: a card stored without a role refuses at its approval in words', async () => {
      const preview = await previews.createPreview(ctx, 'update_entity_relations', {
        entity_type: 'contracts', ref: `CTR-${contractNumber}`, relation: 'contacts', add: [{ contact: contactRef, role: 'support' }],
      });
      // The form of a card asked before the role was required.
      await runner.query(
        `UPDATE ai_mutation_previews SET mutation_input = jsonb_set(mutation_input, '{next_items}', $2::jsonb) WHERE id = $1`,
        [preview.preview_id, JSON.stringify([{ key: `${contactId}::manual`, label: 'Maëlle Kerbrat', payload: { contact_id: contactId, role: null, origin: 'manual' } }])],
      );
      const executed = await previews.executePreview(ctx, preview.preview_id);
      assert.equal(executed.status, 'failed');
      assert.match(String(executed.error_message), /A contact role is required/);
      assert.doesNotMatch(String(executed.error_message), PG_TEXT);
      assert.deepEqual(await runner.query(`SELECT 1 FROM contract_contacts WHERE tenant_id = $1 AND contract_id = $2`, [tenantId, contractId]), []);
    });

    for (const family of [
      { name: 'application', entity: 'applications', ref: 'APP-9101', table: 'application_support_contacts' },
      { name: 'asset', entity: 'assets', ref: 'srv-roles', table: 'asset_support_contacts' },
    ]) {
      await cell(`${family.name} support contacts: any role or none, as the Support panel`, async () => {
        const executed = await approve({ entity_type: family.entity, ref: family.ref, relation: 'support_contacts', add: [{ contact: contactRef }] });
        assert.equal(executed.status, 'executed', executed.error_message ?? '');
        const again = await approve({ entity_type: family.entity, ref: family.ref, relation: 'support_contacts', add: [{ contact: contactRef, role: 'Astreinte' }] });
        assert.equal(again.status, 'executed', again.error_message ?? '');
        const rows = await runner.query(`SELECT role FROM ${family.table} WHERE tenant_id = $1 AND contact_id = $2 ORDER BY role NULLS FIRST`, [tenantId, contactId]);
        assert.ok(rows.length >= 1 && rows.some((row: any) => row.role === 'Astreinte'), JSON.stringify(rows));
      });
    }

    await cell('application owners: an owner without business or it is refused before the card', async () => {
      const refusal = await refused({ entity_type: 'applications', ref: 'APP-9101', relation: 'owners', add: [{ user: `writer-${tenantId.slice(0, 8)}@example.test` }] });
      assert.match(refusal, /Owner role must be business or it/);
      const executed = await approve({ entity_type: 'applications', ref: 'APP-9101', relation: 'owners', add: [{ user: `writer-${tenantId.slice(0, 8)}@example.test`, owner_type: 'it' }] });
      assert.equal(executed.status, 'executed', executed.error_message ?? '');
    });
    await cell('application servers: an assignment without a role is refused before the card', async () => {
      const refusal = await refused({ entity_type: 'applications', ref: 'APP-9101', relation: 'asset_assignments', add: [{ environment: 'prod', asset_ref: 'srv-roles' }] });
      assert.match(refusal, /Asset assignment role is required/);
      assert.doesNotMatch(refusal, PG_TEXT);
    });
  } finally {
    await runner.rollbackTransaction().catch(() => undefined);
    await runner.release();
    await app.close();
  }
  console.log(`ai-relation-contact-roles: ${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error(failures.join('\n\n'));
    process.exit(1);
  }
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
