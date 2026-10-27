import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { ContractsService } from '../contracts.service';
import { FxRateService } from '../../currency/fx-rate.service';
import { CurrencySettingsService } from '../../currency/currency-settings.service';
import { CurrencyRateSet } from '../../currency/currency-rate-set.entity';
import { Tenant } from '../../tenants/tenant.entity';
import { assert, captureAudit, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import type { ContractComplianceView } from '../contract-compliance';
import { assertCsvGolden, xlsxCells, xlsxSheetName } from '../../common/csv/__tests__/export-golden';
import { daySerial } from '../../common/xlsx/write';

// The compliance register of the contracts (`contract-compliance.ts`), against a real database,
// on a tenant created here (the catalogs' defaults: high = the two most severe levels; cloud =
// public cloud, private cloud, SaaS):
// - expected requirements and their reasons: personal data, business and cyber criticality, an
//   instance hosted in the cloud; through the applications linked to the contract, and through the
//   assets it covers (linked asset or support contract) and their application instances; an
//   application past its end of validity counts no more;
// - recording a state and a reference: one audit row per change, nothing when nothing changes,
//   the row goes once both are cleared; bad input refused;
// - the list's summary (sort and filter on the server, the page's values, the ids, the totals)
//   and the tab's summary agree;
// - the register (CSV) in the screen's language;
// - another tenant reads and writes nothing of it (service and RLS), and a row cannot name its contract.

type Seed = {
  tenantId: string;
  supplierId: string;
  companyId: string;
  /** Linked to every kind of application. */
  full: string;
  /** Covers an asset only (support contract), whose instance belongs to a cyber-critical application. */
  viaAsset: string;
  /** Nothing linked. */
  bare: string;
  apps: { pii: string; critical: string; cloud: string; ended: string; cyber: string };
  assets: { cloud: string; support: string };
};

async function seed(runner: QueryRunner, tag: string): Promise<Seed> {
  const tenantId = await seedTenant(runner, tag);
  await setTenant(runner, tenantId);
  const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;
  const companyId = await one(
    `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, $2, 'FR', 'Lyon') RETURNING id`,
    [tenantId, `Compliance company ${tag}`],
  );
  const supplierId = await one(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, `Compliance supplier ${tag}`]);
  const contract = (name: string) => one(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, $2, $3, $4, DATE '2026-01-01') RETURNING id`,
    [tenantId, name, companyId, supplierId],
  );
  const full = await contract(`A full ${tag}`);
  const viaAsset = await contract(`B via asset ${tag}`);
  const bare = await contract(`C bare ${tag}`);
  const app = (name: string, columns: string, values: string) => one(
    `INSERT INTO applications (tenant_id, name${columns}) VALUES ($1, $2${values}) RETURNING id`,
    [tenantId, name],
  );
  const apps = {
    pii: await app(`HR ${tag}`, ', contains_pii, criticality', ', true, \'low\''),
    critical: await app(`ERP ${tag}`, ', criticality, cyber_criticality', ', \'business_critical\', \'moderate\''),
    cloud: await app(`CRM ${tag}`, ', criticality', ', \'medium\''),
    ended: await app(`Old ${tag}`, ', contains_pii, criticality, disabled_at', ', true, \'business_critical\', now() - interval \'1 day\''),
    cyber: await app(`Mail ${tag}`, ', cyber_criticality', ', \'high\''),
  };
  const location = (name: string, hosting: string, ref: string) => one(
    `INSERT INTO locations (tenant_id, name, hosting_type, location_reference) VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, name, hosting, ref],
  );
  const saas = await location(`SaaS ${tag}`, 'saas', `LOC-C1-${tag}`);
  const room = await location(`Room ${tag}`, 'on_prem', `LOC-C2-${tag}`);
  const asset = (name: string, locationId: string) => one(
    `INSERT INTO assets (tenant_id, name, kind, provider, environment, status, location_id, created_at, updated_at)
     VALUES ($1, $2, 'virtual_machine', 'on_premise', 'prod', 'active', $3, now(), now()) RETURNING id`,
    [tenantId, name, locationId],
  );
  const assets = { cloud: await asset(`crm-cloud-${tag}`, saas), support: await asset(`mail-srv-${tag}`, room) };
  const instance = async (applicationId: string, assetId: string) => {
    const instanceId = await one(`INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, 'prod') RETURNING id`, [tenantId, applicationId]);
    await runner.query(`INSERT INTO app_asset_assignments (tenant_id, app_instance_id, asset_id, role) VALUES ($1, $2, $3, 'app')`, [tenantId, instanceId, assetId]);
  };
  await instance(apps.cloud, assets.cloud);
  await instance(apps.cyber, assets.support);
  for (const applicationId of [apps.pii, apps.critical, apps.cloud, apps.ended]) {
    await runner.query(`INSERT INTO application_contracts (tenant_id, application_id, contract_id) VALUES ($1, $2, $3)`, [tenantId, applicationId, full]);
  }
  await runner.query(`INSERT INTO asset_support_info (tenant_id, asset_id, support_contract_id) VALUES ($1, $2, $3)`, [tenantId, assets.support, viaAsset]);
  return { tenantId, supplierId, companyId, full, viaAsset, bare, apps, assets };
}

function service(runner: QueryRunner, audit: { log: (...args: any[]) => Promise<void> } = captureAudit()): ContractsService {
  const settings = new CurrencySettingsService(runner.manager.getRepository(Tenant), audit as any);
  const fx = new FxRateService(runner.manager.getRepository(CurrencyRateSet), settings);
  const args: any[] = Array.from({ length: 10 }, () => undefined);
  args[4] = audit;
  args[9] = fx;
  return new (ContractsService as any)(...args);
}

async function rejection(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected a refusal');
}

/** requirement -> "rule app [asset] [level]" for each reason, sorted. */
function reasonsOf(view: ContractComplianceView): Record<string, string[]> {
  return Object.fromEntries(view.requirements.map((item) => [
    item.requirement,
    item.reasons.map((r) => [r.rule, r.application.name, r.asset?.name, r.level?.code].filter(Boolean).join(' ')),
  ]));
}

async function testExpectations() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner, 'ccx');
    const svc = service(runner);
    const opts = { manager: runner.manager };

    const full = await svc.compliance(s.full, opts);
    assert.deepEqual(reasonsOf(full), {
      gdpr_dpa: ['personal_data HR ccx'],
      data_location: ['cloud_hosting CRM ccx saas', 'personal_data HR ccx'],
      reversibility: ['business_criticality ERP ccx business_critical'],
      exit_plan: ['business_criticality ERP ccx business_critical'],
      audit_security: ['business_criticality ERP ccx business_critical'],
    }, 'the ended application counts no more; medium and moderate are not high');
    assert.deepEqual(full.summary, { expected: 5, missing: 0, to_check: 5, state: 'to_check' });
    const location = full.requirements.find((item) => item.requirement === 'data_location')!;
    assert.deepEqual(location.reasons[0].level, { axis: 'hostingTypes', code: 'saas', label: 'SaaS' }, 'the hosting type as the settings name it');

    const viaAsset = await svc.compliance(s.viaAsset, opts);
    assert.deepEqual(reasonsOf(viaAsset), {
      gdpr_dpa: [],
      data_location: [],
      reversibility: ['cyber_criticality Mail ccx mail-srv-ccx high'],
      exit_plan: ['cyber_criticality Mail ccx mail-srv-ccx high'],
      audit_security: ['cyber_criticality Mail ccx mail-srv-ccx high'],
    }, 'reached through the asset it supports');

    // The same asset linked to the bare contract from its Relations tab counts too; linked directly
    // as well, the application is named without the asset.
    await runner.query(`INSERT INTO asset_contracts (tenant_id, asset_id, contract_id) VALUES ($1, $2, $3)`, [s.tenantId, s.assets.support, s.bare]);
    assert.deepEqual(reasonsOf(await svc.compliance(s.bare, opts)).exit_plan, ['cyber_criticality Mail ccx mail-srv-ccx high']);
    await runner.query(`INSERT INTO application_contracts (tenant_id, application_id, contract_id) VALUES ($1, $2, $3)`, [s.tenantId, s.apps.cyber, s.bare]);
    assert.deepEqual(reasonsOf(await svc.compliance(s.bare, opts)).exit_plan, ['cyber_criticality Mail ccx high']);
  });
}

async function testRecording() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner, 'ccr');
    const audit = captureAudit();
    const svc = service(runner, audit);
    const opts = { manager: runner.manager };
    // A real user: `updated_by` has a foreign key into users (migration 1854160000000).
    const roleId = randomUUID();
    await runner.query(
      `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
       VALUES ($1, $2, 'Compliance role', 'Compliance role', false, false, now(), now())`,
      [roleId, s.tenantId],
    );
    const [{ id: userId }] = await runner.query(
      `INSERT INTO users (tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status)
       VALUES ($1, 'Compliance', 'Recorder', $2, null, $3, false, 'enabled') RETURNING id`,
      [s.tenantId, `recorder-${s.tenantId.slice(0, 8)}@compliance.test`, roleId],
    );

    let view = await svc.updateCompliance(s.full, 'gdpr_dpa', { state: 'absent' }, userId, opts);
    assert.deepEqual(view.summary, { expected: 5, missing: 1, to_check: 4, state: 'missing' });
    const dpa = () => view.requirements.find((item) => item.requirement === 'gdpr_dpa')!;
    assert.equal(dpa().state, 'absent');
    assert.equal(dpa().updated_by?.id, userId);
    assert.ok(dpa().updated_at);

    view = await svc.updateCompliance(s.full, 'gdpr_dpa', { reference: '  Annex 4, art. 12  ' }, userId, opts);
    assert.equal(dpa().reference, 'Annex 4, art. 12', 'trimmed');
    assert.equal(dpa().state, 'absent', 'a field left out is kept');
    // The same value again writes and logs nothing.
    await svc.updateCompliance(s.full, 'gdpr_dpa', { reference: 'Annex 4, art. 12' }, userId, opts);
    assert.deepEqual(audit.entries.map((entry) => [entry.table, entry.action]), [
      ['contract_compliance_items', 'create'],
      ['contract_compliance_items', 'update'],
    ]);
    assert.equal((audit.entries[1].before as any).reference, null);
    assert.equal((audit.entries[1].after as any).reference, 'Annex 4, art. 12');

    // A requirement not expected is recorded too and does not count.
    view = await svc.updateCompliance(s.bare, 'exit_plan', { state: 'absent' }, userId, opts);
    assert.deepEqual(view.summary, { expected: 0, missing: 0, to_check: 0, state: 'none' });
    assert.equal(view.requirements.find((item) => item.requirement === 'exit_plan')!.state, 'absent');

    // Clearing both removes the row.
    await svc.updateCompliance(s.full, 'gdpr_dpa', { state: null }, userId, opts);
    view = await svc.updateCompliance(s.full, 'gdpr_dpa', { reference: '' }, userId, opts);
    assert.deepEqual([dpa().state, dpa().reference, dpa().updated_at], [null, null, null]);
    assert.equal(audit.entries.at(-1)?.action, 'delete');
    const [{ count }] = await runner.query(`SELECT count(*)::int AS count FROM contract_compliance_items WHERE contract_id = $1`, [s.full]);
    assert.equal(count, 0);

    // Refused: unknown requirement, state or empty body, a reference too long, an unknown contract.
    for (const [requirement, body] of [
      ['nis2', { state: 'present' }],
      ['gdpr_dpa', { state: 'yes' }],
      ['gdpr_dpa', {}],
      ['gdpr_dpa', { reference: 12 }],
      ['gdpr_dpa', { reference: 'x'.repeat(501) }],
    ] as const) {
      assert.ok((await rejection(() => svc.updateCompliance(s.full, requirement, body as any, userId, opts))) instanceof BadRequestException, `${requirement} ${JSON.stringify(body)}`);
    }
    assert.ok((await rejection(() => svc.updateCompliance('00000000-0000-4000-8000-0000000000ff', 'gdpr_dpa', { state: 'present' }, userId, opts))) instanceof NotFoundException);
  });
}

async function testListColumn() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner, 'ccl');
    const svc = service(runner);
    const opts = { manager: runner.manager };
    // full: one missing; viaAsset: complete (present or not applicable); bare: nothing expected.
    await svc.updateCompliance(s.full, 'exit_plan', { state: 'absent' }, null, opts);
    for (const requirement of ['reversibility', 'exit_plan'] as const) {
      await svc.updateCompliance(s.viaAsset, requirement, { state: 'present' }, null, opts);
    }
    await svc.updateCompliance(s.viaAsset, 'audit_security', { state: 'not_applicable' }, null, opts);

    const page = await svc.list({}, opts);
    const byId = new Map(page.items.map((item: any) => [item.id, item.compliance]));
    assert.deepEqual(byId.get(s.full), { expected: 5, missing: 1, to_check: 4, state: 'missing' });
    assert.deepEqual(byId.get(s.viaAsset), { expected: 3, missing: 0, to_check: 0, state: 'complete' });
    assert.deepEqual(byId.get(s.bare), { expected: 0, missing: 0, to_check: 0, state: 'none' });
    // The tab says the same.
    for (const id of [s.full, s.viaAsset, s.bare]) assert.deepEqual((await svc.compliance(id, opts)).summary, byId.get(id), id);

    // Sorted on the server: none, complete, then missing (ascending), and back.
    const names = (items: any[]) => items.map((item) => item.id);
    assert.deepEqual(names((await svc.list({ sort: 'compliance_state:ASC' }, opts)).items), [s.bare, s.viaAsset, s.full]);
    assert.deepEqual(names((await svc.list({ sort: 'compliance_state:DESC' }, opts)).items), [s.full, s.viaAsset, s.bare]);
    assert.deepEqual((await svc.listIds({ sort: 'compliance_state:DESC' }, opts)).ids, [s.full, s.viaAsset, s.bare], 'prev / next in the same order');

    // Filtered on the server, the totals counting the same contracts.
    const filter = (...values: string[]) => JSON.stringify({ compliance_state: { filterType: 'set', values } });
    assert.deepEqual(names((await svc.list({ filters: filter('missing', 'to_check') }, opts)).items), [s.full]);
    assert.deepEqual(names((await svc.list({ filters: filter('none') }, opts)).items), [s.bare]);
    assert.equal((await svc.totals({ filters: filter('complete', 'none') }, opts)).count, 2);
  });
}

async function testRegister() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner, 'cce');
    const svc = service(runner);
    const opts = { manager: runner.manager };
    await svc.updateCompliance(s.full, 'gdpr_dpa', { state: 'absent', reference: 'DPA; v2' }, null, opts);

    const fr = await svc.exportComplianceRegister({ sort: 'name:ASC' }, 'fr', opts);
    // Today's date: the day the requirement was recorded.
    const today = new Date().toISOString().slice(0, 10);
    const noToday = (text: string) => text.split(today).join('<today>');
    assertCsvGolden('contract-compliance-register.fr', fr.content, noToday);
    assertCsvGolden('contract-compliance-register.en', (await svc.exportComplianceRegister({ sort: 'name:ASC' }, 'en', opts)).content, noToday);
    assert.equal(fr.filename, 'contract-compliance-register.csv');
    const lines = fr.content.replace(/^﻿/, '').trim().split('\n');
    assert.equal(lines[0], 'Contrat;Fournisseur;Société;Exigence;Attendue;Raison;État;Référence;Mis à jour le;Mis à jour par');
    assert.equal(lines.length, 1 + 3 * 5, 'one line per contract and requirement');
    assert.equal(
      lines[1],
      `A full cce;Compliance supplier cce;Compliance company cce;Accord de sous-traitance RGPD (art. 28);Oui;HR cce contient des données personnelles;Absente;"DPA; v2";${today};`,
    );
    assert.ok(lines[2].includes(';Localisation des données;Oui;"CRM cce : hébergement SaaS; HR cce contient des données personnelles";À vérifier;'), lines[2]);
    assert.ok(lines.some((line) => line.startsWith('B via asset cce;') && line.includes('Mail cce : criticité cyber High (actif mail-srv-cce)')));
    assert.ok(lines.some((line) => line.startsWith('C bare cce;') && line.includes(';Plan de sortie;Non;;;;;')), 'not expected, nothing recorded');

    // The workbook: the day of the last update is a date, the rest the CSV's text.
    const book = await svc.exportComplianceRegister({ sort: 'name:ASC' }, 'fr', { ...opts, format: 'xlsx' });
    assert.equal(book.filename, 'contract-compliance-register.xlsx');
    assert.equal(book.rows, 15);
    assert.equal(xlsxSheetName(book.content), 'Registre de conformité');
    const x = xlsxCells(book.content);
    assert.equal(x.I2[1], String(daySerial(today)));
    assert.notEqual(x.I2[0], 'text');
    assert.deepEqual(x.H2, ['text', 'DPA; v2']);

    // The list's sort: the contracts in its order, each one's requirements together.
    const byNameDesc = await svc.exportComplianceRegister({ sort: 'name:DESC' }, 'en', opts);
    const firsts = byNameDesc.content.replace(/^﻿/, '').trim().split('\n').slice(1).map((line) => line.split(',')[0]);
    assert.deepEqual([firsts[0], firsts[5], firsts[10]], ['C bare cce', 'B via asset cce', 'A full cce']);

    // The list's request narrows it; English uses the comma.
    const en = await svc.exportComplianceRegister({ q: 'bare' }, 'en', opts);
    const enLines = en.content.replace(/^﻿/, '').trim().split('\n');
    assert.equal(enLines[0], 'Contract,Supplier,Company,Requirement,Expected,Reason,State,Reference,Updated on,Updated by');
    assert.equal(enLines.length, 1 + 5);
  });
}

async function testOtherTenant() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seed(runner, 'cca');
    await service(runner).updateCompliance(a.full, 'gdpr_dpa', { state: 'present' }, null, { manager: runner.manager });
    const b = await seed(runner, 'ccb');
    await setTenant(runner, b.tenantId);
    const svc = service(runner);
    const opts = { manager: runner.manager };

    for (const call of [
      () => svc.compliance(a.full, opts),
      () => svc.updateCompliance(a.full, 'gdpr_dpa', { state: 'absent' }, null, opts),
    ]) {
      assert.ok((await rejection(call)) instanceof NotFoundException);
    }
    const [{ count }] = await runner.query(`SELECT count(*)::int AS count FROM contract_compliance_items`);
    assert.equal(count, 0, "RLS hides the other tenant's rows");
    const register = await svc.exportComplianceRegister({}, 'en', opts);
    assert.ok(!register.content.includes('cca'), 'nothing of the other tenant in the register');

    // RLS refuses a row written for the other tenant; the composite key refuses its contract.
    await runner.query('SAVEPOINT other_tenant');
    await assert.rejects(
      runner.query(`INSERT INTO contract_compliance_items (tenant_id, contract_id, requirement, state) VALUES ($1, $2, 'gdpr_dpa', 'present')`, [a.tenantId, a.full]),
      /row-level security/,
    );
    await runner.query('ROLLBACK TO SAVEPOINT other_tenant');
    await assert.rejects(
      runner.query(`INSERT INTO contract_compliance_items (tenant_id, contract_id, requirement, state) VALUES ($1, $2, 'gdpr_dpa', 'present')`, [b.tenantId, a.full]),
      /contract_compliance_items_contract_fk/,
    );
    await runner.query('ROLLBACK TO SAVEPOINT other_tenant');

    // A contract's rows go with it.
    await setTenant(runner, a.tenantId);
    await runner.query(`DELETE FROM application_contracts WHERE contract_id = $1`, [a.full]);
    await runner.query(`DELETE FROM contracts WHERE id = $1`, [a.full]);
    const [{ left }] = await runner.query(`SELECT count(*)::int AS left FROM contract_compliance_items WHERE contract_id = $1`, [a.full]);
    assert.equal(left, 0);
  });
}

void runSpecs('contract-compliance.integration.spec', [
  ['testExpectations', testExpectations],
  ['testRecording', testRecording],
  ['testListColumn', testListColumn],
  ['testRegister', testRegister],
  ['testOtherTenant', testOtherTenant],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
