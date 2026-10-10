import 'dotenv/config';

// What the application module needs to boot, test values only (no storage call is made).
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.STRIPE_SECRET_KEY = '';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9000';
process.env.S3_BUCKET ||= 'test-bucket';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';
import { INestApplicationContext, Logger, LoggerService } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { CapexItemsService, SpendItemsService } from '../spend-items.service';
import { CapexVersionsService, SpendVersionsService } from '../spend-versions.service';
import { CapexAmountsService, SpendAmountsService } from '../spend-amounts.service';
import { CapexAllocationsService, SpendAllocationsService } from '../spend-allocations.service';
import { CapexItemContactsService, SpendItemContactsService } from '../spend-item-contacts.service';
import { CapexItemsDeleteService, SpendItemsDeleteService } from '../spend-items-delete.service';
import { SpendItemsController } from '../spend-items.controller';
import { SpendVersionsController } from '../spend-versions.controller';
import { CapexItemsController } from '../capex-items.controller';
import { CapexVersionsController } from '../capex-versions.controller';
import { syncSupplierContactsWithinUpdate } from '../../contacts/contact-link-attach.util';
import { assert, runSpecs } from './round-inputs.fixtures';
import { seedCompany } from './cost-center.fixtures';

// The CAPEX aliases as the application wires them: the whole AppModule built by Nest's own
// injection, no stub. A CAPEX alias is its OPEX twin with `nature = 'capex'`; a subclass without
// a constructor of its own inherits its parent's parameter types, so Nest would hand it the OPEX
// dependencies. Checked here:
// - every provider and controller of the application that carries a nature gets dependencies of
//   that nature only (each dependency that carries a `nature`); the CAPEX aliases are among them,
//   and the CAPEX items service has its contacts service (the check is not vacuous);
// - `PATCH /capex-items/:id` with another supplier, through the controller Nest built, replaces the
//   line's supplier contacts and audits them as `capex_item_contacts`;
// - a failed supplier contact sync keeps the update and is logged through the Nest logger with the
//   record it was about.
// @database-spec: boots the application context on the database.

type Nature = 'opex' | 'capex';

/** The dependencies of an instance that carry a nature, by property name. */
function natureDependencies(instance: object): Array<[string, Nature]> {
  return Object.entries(instance)
    .filter(([, value]) => value && typeof value === 'object' && typeof (value as { nature?: unknown }).nature === 'string')
    .map(([key, value]) => [key, (value as { nature: Nature }).nature]);
}

async function withApplication(fn: (app: INestApplicationContext) => Promise<void>) {
  // Required here: the application module reads its environment when loaded.
  const { AppModule } = require('../../app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}

async function testNestInjectsTheNature() {
  await withApplication(async (app) => {
    const pairs: Array<[new (...args: any[]) => object, new (...args: any[]) => object]> = [
      [SpendItemsService, CapexItemsService],
      [SpendVersionsService, CapexVersionsService],
      [SpendAmountsService, CapexAmountsService],
      [SpendAllocationsService, CapexAllocationsService],
      [SpendItemContactsService, CapexItemContactsService],
      [SpendItemsDeleteService, CapexItemsDeleteService],
    ];
    for (const [twin, alias] of pairs) {
      const opex = app.get(twin, { strict: false }) as { nature?: Nature };
      const capex = app.get(alias, { strict: false }) as { nature?: Nature };
      assert.equal(capex.constructor, alias, `${alias.name}: Nest builds the alias itself`);
      assert.deepEqual([opex.nature, capex.nature], ['opex', 'capex'], `${twin.name} / ${alias.name}: their nature`);
      for (const [key, nature] of natureDependencies(capex)) assert.equal(nature, 'capex', `${alias.name}.${key}: a CAPEX dependency`);
      for (const [key, nature] of natureDependencies(opex)) assert.equal(nature, 'opex', `${twin.name}.${key}: an OPEX dependency`);
    }
    assert.deepEqual(
      natureDependencies(app.get(CapexItemsService, { strict: false })),
      [['itemContacts', 'capex']],
      'the CAPEX items service syncs supplier contacts with the CAPEX contacts service',
    );

    const controllers: Array<[new (...args: any[]) => object, Nature, string[]]> = [
      [SpendItemsController, 'opex', ['svc', 'deleteSvc', 'contactsSvc']],
      [SpendVersionsController, 'opex', ['versions', 'amounts', 'allocations']],
      [CapexItemsController, 'capex', ['svc', 'deleteSvc', 'contactsSvc']],
      [CapexVersionsController, 'capex', ['versions', 'amounts', 'allocations']],
    ];
    for (const [controller, expected, keys] of controllers) {
      const deps = natureDependencies(app.get(controller, { strict: false }));
      assert.deepEqual(deps.map(([key]) => key).sort(), [...keys].sort(), `${controller.name}: its services of a nature`);
      for (const [key, nature] of deps) assert.equal(nature, expected, `${controller.name}.${key}: ${expected}`);
    }

    // Every instance the application built that carries a nature: its dependencies share it.
    const container = (app as unknown as { container: { getModules(): Map<string, { providers: Map<unknown, { instance: unknown }>; controllers: Map<unknown, { instance: unknown }> }> } }).container;
    let checked = 0;
    for (const module of container.getModules().values()) {
      for (const wrapper of [...module.providers.values(), ...module.controllers.values()]) {
        const instance = wrapper.instance as { nature?: unknown } | null;
        if (!instance || typeof instance !== 'object' || (instance.nature !== 'opex' && instance.nature !== 'capex')) continue;
        checked++;
        for (const [key, nature] of natureDependencies(instance)) {
          assert.equal(nature, instance.nature, `${instance.constructor.name}.${key}: the nature of its owner`);
        }
      }
    }
    assert.ok(checked >= 12, `every service of a nature is checked (${checked})`);
  });
}

async function inRolledBackTransaction(app: INestApplicationContext, fn: (runner: QueryRunner) => Promise<void>) {
  const runner = app.get(DataSource).createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await fn(runner);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testPatchSupplierSyncsCapexContacts() {
  await withApplication(async (app) => {
    await inRolledBackTransaction(app, async (runner) => {
      const tenantId = randomUUID();
      await runner.query(
        `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
         VALUES ($1, $2, 'CAPEX alias injection', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
        [tenantId, `capex-di-${tenantId.slice(0, 8)}`],
      );
      await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;
      const supplierOne = await one(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Supplier one') RETURNING id`, [tenantId]);
      const supplierTwo = await one(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Supplier two') RETURNING id`, [tenantId]);
      const contactOne = await one(`INSERT INTO contacts (tenant_id, email) VALUES ($1, 'one@example.invalid') RETURNING id`, [tenantId]);
      const contactTwo = await one(`INSERT INTO contacts (tenant_id, email) VALUES ($1, 'two@example.invalid') RETURNING id`, [tenantId]);
      await runner.query(
        `INSERT INTO supplier_contacts (tenant_id, supplier_id, contact_id, role) VALUES ($1, $2, $3, 'commercial'), ($1, $4, $5, 'technical')`,
        [tenantId, supplierOne, contactOne, supplierTwo, contactTwo],
      );
      const { companyId } = await seedCompany(runner, tenantId, 'Injection company');
      const lineId = await one(
        `INSERT INTO spend_items (tenant_id, nature, item_number, legacy_number, product_name, ppe_type, investment_type, priority,
                                  currency, effective_start, supplier_id, paying_company_id)
         VALUES ($1, 'capex', 1, 'CPX-1', 'Injected CAPEX line', 'hardware', 'replacement', 'medium', 'EUR', '2024-01-01', $2, $3) RETURNING id`,
        [tenantId, supplierOne, companyId],
      );
      await runner.query(
        `INSERT INTO spend_item_contacts (tenant_id, spend_item_id, contact_id, role, origin) VALUES ($1, $2, $3, 'commercial', 'supplier')`,
        [tenantId, lineId, contactOne],
      );

      const controller = app.get(CapexItemsController, { strict: false }) as CapexItemsController;
      const ctx = { manager: runner.manager, tenantId, userId: '', userRoles: [] } as any;
      const answer: any = await controller.update(lineId, { supplier_id: supplierTwo } as any, ctx);
      assert.deepEqual([answer.supplier_id, answer.item_number, answer.description], [supplierTwo, 1, 'Injected CAPEX line'], 'the CAPEX answer');

      const contacts = await runner.query(
        `SELECT contact_id, role::text AS role FROM spend_item_contacts WHERE tenant_id = $1 AND spend_item_id = $2 AND origin = 'supplier'`,
        [tenantId, lineId],
      );
      assert.deepEqual(contacts, [{ contact_id: contactTwo, role: 'technical' }], "the old supplier's contact goes, the new one's comes");
      const audits = await runner.query(
        `SELECT table_name, before_json, after_json FROM audit_log WHERE tenant_id = $1 AND record_id = $2 ORDER BY table_name`,
        [tenantId, lineId],
      );
      assert.deepEqual(audits.map((row: any) => row.table_name), ['capex_item_contacts', 'capex_items'], 'the line and its contacts, audited under their CAPEX labels');
      const contactAudit = audits.find((row: any) => row.table_name === 'capex_item_contacts');
      assert.deepEqual([contactAudit.before_json, contactAudit.after_json], [[`${contactOne}:commercial`], [`${contactTwo}:technical`]]);
    });
  });
}

async function testFailedSyncIsLogged() {
  const warnings: string[] = [];
  const logger: LoggerService = {
    log: () => undefined,
    error: () => undefined,
    warn: (message: unknown, context?: unknown) => { warnings.push(`${context}: ${message}`); },
    debug: () => undefined,
    verbose: () => undefined,
  };
  Logger.overrideLogger(logger);
  try {
    const savepoints: string[] = [];
    const manager = { query: async (sql: string) => { savepoints.push(sql); return []; } } as any;
    await syncSupplierContactsWithinUpdate(manager, 'CAPEX item 0000-line', async () => { throw new Error('Capex item not found'); });
    assert.deepEqual(
      warnings,
      ['SupplierContactSync: Supplier contacts of CAPEX item 0000-line not synced, the update is kept: Error: Capex item not found'],
      'the failure is logged by the Nest logger, with the record and the error; the update goes on',
    );
  } finally {
    Logger.overrideLogger(['error', 'warn', 'log']);
  }
}

void runSpecs('capex-alias-injection.integration.spec', [
  ['testNestInjectsTheNature', testNestInjectsTheNature],
  ['testPatchSupplierSyncsCapexContacts', testPatchSupplierSyncsCapexContacts],
  ['testFailedSyncIsLogged', testFailedSyncIsLogged],
]);
