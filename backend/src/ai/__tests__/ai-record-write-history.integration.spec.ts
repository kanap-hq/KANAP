import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { seedManagedDocsKnowledgeAssets } from '../../knowledge/integrated-document-seed';

// Lot K2a of 26.12.1: a write of Kad leaves one history line per record it writes, attributed to
// Kad for the person (source `ai_chat`, reference = the approved card), with the values the
// screen writes for the same gesture. "Undo" writes one line too.
//
// Driven by a table (`CASES`): one entry per gesture of a family. Each entry plays Kad's card up to
// its approval (the preview service, no model), then reads the audit log:
// - the record's own audit rows written by the approval: exactly one, `ai_chat`, the card's id,
//   the person who approved;
// - every row the approval wrote, compared with the rows the screen's service writes for the same
//   gesture (played first under a savepoint, then rolled back): same tables, actions and values,
//   ids and dates set aside; only the attribution differs;
// - the record's History tab (`RecordHistoryService.list`) shows one more entry, by Kad;
// - "Undo" of a reversible change writes one row for the record, attributed the same way.
//
// To add a family: seed what it needs in `seed`, give its role the module right in `PERMISSIONS`,
// then add its entries to `CASES` (`card`: the tool and input; `screen`: the screen's service call;
// `prepare`: the record an update changes, created through the screen's service).
//
// A gesture on a child of a record (a budget line's version, amounts, allocations) names that
// record in `historyOf`: its History tab is the one read, and the card's target is its id.

process.env.AI_CHAT_ENABLED = 'true';
process.env.AI_SETTINGS_ENABLED = 'true';
process.env.AI_MCP_ENABLED = 'true';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.STRIPE_SECRET_KEY = '';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9000';
process.env.S3_BUCKET ||= 'test-bucket';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Harness = {
  app: any;
  dataSource: DataSource;
  tools: any;
  previews: any;
  services: {
    applications: any; assets: any; contracts: any; budgetLines: any; projects: any; requests: any; interfaces: any; connections: any;
    versions: Record<'opex' | 'capex', any>; amounts: Record<'opex' | 'capex', any>; allocations: Record<'opex' | 'capex', any>;
  };
};

type Seed = {
  tenantId: string;
  userId: string;
  userName: string;
  companyId: string;
  secondCompanyId: string;
  supplierId: string;
  accountId: string;
  locationId: string;
  sourceAppId: string;
  targetAppId: string;
  sourceAssetId: string;
  targetAssetId: string;
};

type AuditRow = {
  id: string;
  table_name: string;
  record_id: string | null;
  action: string;
  before_json: unknown;
  after_json: unknown;
  user_id: string | null;
  source: string | null;
  source_ref: string | null;
};

type HistoryCase = {
  /** `<family>: <gesture>`, as the failures name it. */
  name: string;
  /** The audit table of the record's own row, which is also its History tab's table (unless `historyOf`). */
  table: string;
  /**
   * The gesture writes a child of the record whose History tab shows it (a budget line's version,
   * amounts or allocations): that record's table, and the kind of entry the child makes there. The
   * record's id is the card's target, which `screen` returns too; the child's own rows are the rows
   * of `table`, whatever their id (amounts and allocations are keyed by their version).
   */
  historyOf?: { table: string; kind: string };
  /** The record an update changes, created through the screen's service. */
  prepare?: (h: Harness, runner: QueryRunner, s: Seed) => Promise<string>;
  /** Kad's card. */
  card: (s: Seed, recordId: string | null) => { tool: string; input: Record<string, unknown> };
  /**
   * The same gesture by the screen's service, with the fields the card stored (and its whole stored
   * input, for amounts and allocations); returns the record id.
   */
  screen: (h: Harness, runner: QueryRunner, s: Seed, fields: Record<string, unknown>, recordId: string | null, mutation: Record<string, any>) => Promise<string>;
  /** The card is a reversible change: "Undo" is checked. */
  undo?: boolean;
};

/** The module rights of the person who approves: one per family of `CASES`. */
const PERMISSIONS: Record<string, string> = {
  ai_chat: 'member',
  applications: 'member',
  infrastructure: 'member',
  contracts: 'member',
  budget: 'member',
  portfolio_projects: 'member',
  portfolio_requests: 'member',
};

const screenOpts = (runner: QueryRunner, s: Seed) => ({ manager: runner.manager, tenantId: s.tenantId });
const projectOpts = (runner: QueryRunner, s: Seed) => ({ manager: runner.manager, tenantId: s.tenantId, userId: s.userId });
const interfaceFields = (s: Seed) => ({
  name: 'History interface', business_purpose: 'Orders to billing', data_category: 'master_data',
  source_application_id: s.sourceAppId, target_application_id: s.targetAppId,
});
const connectionFields = (s: Seed) => ({
  name: 'History connection', topology: 'server_to_server', source_asset_id: s.sourceAssetId, destination_asset_id: s.targetAssetId,
  protocol_codes: ['https'],
});
const lineFields = (s: Seed, nature: 'opex' | 'capex' = 'opex') => ({
  nature, product_name: 'History line', paying_company_id: s.companyId, account_id: s.accountId, currency: 'EUR', effective_start: '2026-01-01',
});
/** The 2026 version of a line, as the budget tab creates it before its first amount. */
const VERSION_2026 = { version_name: 'Y2026', budget_year: 2026, as_of_date: '2026-01-01', input_grain: 'annual' };
const versionOf = async (runner: QueryRunner, s: Seed, lineId: string, year = 2026) => one(runner,
  `SELECT id FROM spend_versions WHERE tenant_id = $1 AND spend_item_id = $2 AND budget_year = $3`, [s.tenantId, lineId, year]);
/** A budget line with its 2026 version, through the screen's services. */
async function lineWithVersion(h: Harness, runner: QueryRunner, s: Seed, nature: 'opex' | 'capex' = 'opex', version: Record<string, unknown> = {}) {
  const lineId = String((await h.services.budgetLines.create(lineFields(s, nature), s.userId, { manager: runner.manager })).id);
  await h.services.versions[nature].createForItem(lineId, { ...VERSION_2026, ...version }, s.userId, { manager: runner.manager });
  return lineId;
}
const BUDGET_LINE = { table: 'spend_items', kind: 'version' };

const CASES: HistoryCase[] = [
  {
    name: 'applications: create',
    table: 'applications',
    card: () => ({ tool: 'create_business_record', input: { entity_type: 'applications', fields: { name: 'History app', version: '1.0' } } }),
    screen: async (h, runner, s, fields) => String((await h.services.applications.create(fields, s.userId, screenOpts(runner, s))).id),
  },
  {
    name: 'applications: update',
    table: 'applications',
    prepare: async (h, runner, s) => String((await h.services.applications.create({ name: 'History app' }, s.userId, screenOpts(runner, s))).id),
    card: (_s, id) => ({ tool: 'update_business_record', input: { entity_type: 'applications', ref: id, fields: { version: '2.0' } } }),
    screen: async (h, runner, s, fields, id) => String((await h.services.applications.update(id, fields, s.userId, screenOpts(runner, s))).id),
    undo: true,
  },
  {
    name: 'assets: create',
    table: 'assets',
    card: (s) => ({
      tool: 'create_business_record',
      input: { entity_type: 'assets', fields: { name: 'srv-history', kind: 'virtual_machine', provider: 'other', environment: 'prod', location_id: s.locationId, operating_system: 'Ubuntu 24.04' } },
    }),
    screen: async (h, runner, s, fields) => String((await h.services.assets.create(fields, s.tenantId, s.userId, screenOpts(runner, s))).id),
  },
  {
    name: 'assets: update',
    table: 'assets',
    prepare: async (h, runner, s) => String((await h.services.assets.create(
      { name: 'srv-history', kind: 'virtual_machine', provider: 'other', environment: 'prod', location_id: s.locationId }, s.tenantId, s.userId, screenOpts(runner, s),
    )).id),
    card: (_s, id) => ({ tool: 'update_business_record', input: { entity_type: 'assets', ref: id, fields: { region: 'eu-west-3' } } }),
    screen: async (h, runner, s, fields, id) => String((await h.services.assets.update(id, fields, s.tenantId, s.userId, screenOpts(runner, s))).id),
    undo: true,
  },
  {
    name: 'contracts: create',
    table: 'contracts',
    card: (s) => ({
      tool: 'create_business_record',
      input: { entity_type: 'contracts', fields: { name: 'History contract', company_id: s.companyId, supplier_id: s.supplierId, start_date: '2026-01-01' } },
    }),
    screen: async (h, runner, s, fields) => String((await h.services.contracts.create(fields, s.userId, { manager: runner.manager })).id),
  },
  {
    name: 'contracts: update',
    table: 'contracts',
    prepare: async (h, runner, s) => String((await h.services.contracts.create(
      { name: 'History contract', company_id: s.companyId, supplier_id: s.supplierId, start_date: '2026-01-01' }, s.userId, { manager: runner.manager },
    )).id),
    card: (_s, id) => ({ tool: 'update_business_record', input: { entity_type: 'contracts', ref: id, fields: { notice_period_months: 3 } } }),
    screen: async (h, runner, s, fields, id) => String((await h.services.contracts.update(id, fields, s.userId, { manager: runner.manager })).id),
    undo: true,
  },
  {
    name: 'budget_lines: create',
    table: 'spend_items',
    card: (s) => ({
      tool: 'create_business_record',
      input: {
        entity_type: 'budget_lines',
        fields: { nature: 'opex', product_name: 'History line', paying_company_id: s.companyId, account_id: s.accountId, currency: 'EUR', effective_start: '2026-01-01' },
      },
    }),
    screen: async (h, runner, s, fields) => String((await h.services.budgetLines.create(fields, s.userId, { manager: runner.manager })).id),
  },
  {
    name: 'budget_lines: update',
    table: 'spend_items',
    prepare: async (h, runner, s) => String((await h.services.budgetLines.create(
      { nature: 'opex', product_name: 'History line', paying_company_id: s.companyId, account_id: s.accountId, currency: 'EUR', effective_start: '2026-01-01' },
      s.userId, { manager: runner.manager },
    )).id),
    card: (_s, id) => ({ tool: 'update_business_record', input: { entity_type: 'budget_lines', ref: id, fields: { description: 'Renewal' } } }),
    screen: async (h, runner, s, fields, id) => String((await h.services.budgetLines.update(id, fields, s.userId, { manager: runner.manager })).id),
    undo: true,
  },
  // The financial plan: a line created with its amount, then a line's versions, amounts and allocations.
  {
    name: 'budget_lines: create with amounts',
    table: 'spend_items',
    card: (s) => ({
      tool: 'create_business_record',
      input: { entity_type: 'budget_lines', fields: lineFields(s), amounts: { kind: 'annual', year: 2026, totals: { planned: 1200 } } },
    }),
    // The screen creates the line, then its first amount on the budget tab: the year's version, then the amount.
    screen: async (h, runner, s, fields, _id, mutation) => {
      const lineId = String((await h.services.budgetLines.create(fields, s.userId, { manager: runner.manager })).id);
      await h.services.versions.opex.createForItem(lineId, VERSION_2026, s.userId, { manager: runner.manager });
      await h.services.amounts.opex.bulkUpsert(await versionOf(runner, s, lineId), mutation.amounts, s.userId, { manager: runner.manager });
      return lineId;
    },
  },
  {
    name: 'budget_lines: create version',
    table: 'spend_versions',
    historyOf: BUDGET_LINE,
    prepare: async (h, runner, s) => String((await h.services.budgetLines.create(lineFields(s), s.userId, { manager: runner.manager })).id),
    card: (_s, id) => ({
      tool: 'write_financial_plan',
      input: { entity_type: 'budget_lines', ref: id, action: 'create_version', fields: { ...VERSION_2026, version_name: 'Y2027', budget_year: 2027, as_of_date: '2027-01-01' } },
    }),
    screen: async (h, runner, s, fields, id) => {
      await h.services.versions.opex.createForItem(id, fields, s.userId, { manager: runner.manager });
      return String(id);
    },
  },
  {
    name: 'budget_lines: update version',
    table: 'spend_versions',
    historyOf: BUDGET_LINE,
    prepare: (h, runner, s) => lineWithVersion(h, runner, s),
    card: (_s, id) => ({
      tool: 'write_financial_plan',
      input: { entity_type: 'budget_lines', ref: id, action: 'update_version', version_ref: 'Y2026', fields: { notes: 'Renewal budget' } },
    }),
    screen: async (h, runner, s, fields, id) => {
      await h.services.versions.opex.updateForItem(id, { ...fields, id: await versionOf(runner, s, id!) }, s.userId, { manager: runner.manager });
      return String(id);
    },
    undo: true,
  },
  ...(['opex', 'capex'] as const).map((nature): HistoryCase => ({
    name: `budget_lines (${nature}): amounts`,
    table: nature === 'opex' ? 'spend_amounts' : 'capex_amounts',
    historyOf: { table: 'spend_items', kind: 'amounts' },
    prepare: (h, runner, s) => lineWithVersion(h, runner, s, nature),
    card: (_s, id) => ({
      tool: 'write_financial_plan',
      input: { entity_type: 'budget_lines', ref: id, action: 'upsert_amounts', version_ref: 'Y2026', amounts: { kind: 'annual', year: 2026, totals: { planned: 2400 } } },
    }),
    screen: async (h, runner, s, _fields, id, mutation) => {
      await h.services.amounts[nature].bulkUpsert(await versionOf(runner, s, id!), mutation.amounts, s.userId, { manager: runner.manager });
      return String(id);
    },
    undo: true,
  })),
  {
    name: 'budget_lines: allocations',
    table: 'spend_allocations',
    historyOf: { table: 'spend_items', kind: 'allocations' },
    // A line split by hand on the paying company; the card adds a second company.
    prepare: async (h, runner, s) => {
      // A split by company follows the companies' 2026 headcount.
      for (const [companyId, headcount] of [[s.companyId, 60], [s.secondCompanyId, 40]] as const) {
        await runner.query(`INSERT INTO company_metrics (tenant_id, company_id, fiscal_year, headcount, it_users, turnover)
                            VALUES ($1, $2, 2026, $3, 0, 0)`, [s.tenantId, companyId, headcount]);
      }
      const lineId = await lineWithVersion(h, runner, s, 'opex', { allocation_method: 'manual_company' });
      await h.services.allocations.opex.bulkUpsert(await versionOf(runner, s, lineId), [{ company_id: s.companyId, department_id: null }], s.userId, screenOpts(runner, s));
      return lineId;
    },
    card: (s, id) => ({
      tool: 'write_financial_plan',
      input: { entity_type: 'budget_lines', ref: id, action: 'replace_allocations', version_ref: 'Y2026', allocations: [s.companyId, s.secondCompanyId] },
    }),
    // The Allocations tab saves its method and rows together; the method stays the version's.
    screen: async (h, runner, s, _fields, id, mutation) => {
      await h.services.allocations.opex.put(await versionOf(runner, s, id!), { method: 'manual_company', rows: mutation.allocations, base_signature: null }, s.userId, screenOpts(runner, s));
      return String(id);
    },
    undo: true,
  },
  {
    name: 'projects: create',
    table: 'portfolio_projects',
    card: () => ({
      tool: 'create_business_record',
      input: { entity_type: 'projects', fields: { name: 'History project', origin: 'fast_track', purpose: 'Why we run it' } },
    }),
    screen: async (h, runner, s, fields) => String((await h.services.projects.create(fields, s.tenantId, s.userId, projectOpts(runner, s))).id),
  },
  {
    name: 'projects: update',
    table: 'portfolio_projects',
    prepare: async (h, runner, s) => String((await h.services.projects.create(
      { name: 'History project', origin: 'fast_track', purpose: 'Why we run it' }, s.tenantId, s.userId, projectOpts(runner, s),
    )).id),
    card: (_s, id) => ({
      tool: 'update_business_record',
      input: { entity_type: 'projects', ref: id, fields: { name: 'Renamed project', execution_progress: 20, purpose: 'Why we run it now' } },
    }),
    screen: async (h, runner, s, fields, id) => String((await h.services.projects.update(id, fields, s.tenantId, s.userId, projectOpts(runner, s))).id),
    undo: true,
  },
  {
    name: 'requests: create',
    table: 'portfolio_requests',
    card: () => ({
      tool: 'create_business_record',
      input: { entity_type: 'requests', fields: { name: 'History request', purpose: 'Why we ask', risks: 'Late delivery' } },
    }),
    screen: async (h, runner, s, fields) => String((await h.services.requests.create(fields, s.tenantId, s.userId, { manager: runner.manager })).id),
  },
  {
    name: 'requests: update',
    table: 'portfolio_requests',
    prepare: async (h, runner, s) => String((await h.services.requests.create(
      { name: 'History request', purpose: 'Why we ask', risks: 'Late delivery' }, s.tenantId, s.userId, { manager: runner.manager },
    )).id),
    card: (_s, id) => ({
      tool: 'update_business_record',
      input: { entity_type: 'requests', ref: id, fields: { name: 'Renamed request', expected_benefits: 'Fewer errors', risks: 'Later delivery' } },
    }),
    screen: async (h, runner, s, fields, id) => String((await h.services.requests.update(id, fields, s.tenantId, s.userId, { manager: runner.manager })).id),
    undo: true,
  },
  {
    name: 'interfaces: create',
    table: 'interfaces',
    card: (s) => ({ tool: 'create_business_record', input: { entity_type: 'interfaces', fields: interfaceFields(s) } }),
    screen: async (h, runner, s, fields) => String((await h.services.interfaces.create(fields, s.tenantId, s.userId, { manager: runner.manager })).id),
  },
  {
    name: 'interfaces: update',
    table: 'interfaces',
    prepare: async (h, runner, s) => String((await h.services.interfaces.create(interfaceFields(s), s.tenantId, s.userId, { manager: runner.manager })).id),
    card: (_s, id) => ({
      tool: 'update_business_record',
      input: { entity_type: 'interfaces', ref: id, fields: { name: 'Renamed interface', overview_notes: 'Nightly batch' } },
    }),
    screen: async (h, runner, s, fields, id) => String((await h.services.interfaces.update(id, fields, s.tenantId, s.userId, { manager: runner.manager })).id),
    undo: true,
  },
  {
    name: 'connections: create',
    table: 'connections',
    card: (s) => ({ tool: 'create_business_record', input: { entity_type: 'connections', fields: connectionFields(s) } }),
    screen: async (h, runner, s, fields) => String((await h.services.connections.create(fields, s.tenantId, s.userId, { manager: runner.manager })).id),
  },
  {
    name: 'connections: update',
    table: 'connections',
    prepare: async (h, runner, s) => String((await h.services.connections.create(connectionFields(s), s.tenantId, s.userId, { manager: runner.manager })).id),
    card: (_s, id) => ({ tool: 'update_business_record', input: { entity_type: 'connections', ref: id, fields: { description: 'Nightly sync' } } }),
    screen: async (h, runner, s, fields, id) => String((await h.services.connections.update(id, fields, s.tenantId, s.userId, { manager: runner.manager })).id),
    undo: true,
  },
];

/**
 * A suite of cards on one budget line, "Undo" included, against the same suite of gestures on the
 * screen: every approval writes, under Kad's name, the audit rows the screen writes for its gesture,
 * and the line ends in the state the screen leaves (`state`), which for an undo is the state before
 * the card it undoes (`stateBefore`: the state right after `prepare`).
 */
type SequenceCase = {
  name: string;
  /** The line the suite works on, with its 2026 version, through the screen's services. */
  prepare: (h: Harness, runner: QueryRunner, s: Seed) => Promise<string>;
  steps: Array<{
    /** A card, or "Undo" of the card of an earlier step (its index). */
    kad: ((s: Seed, lineId: string) => { tool: string; input: Record<string, unknown> }) | { undo: number };
    /** The same gesture on the screen. */
    screen: (h: Harness, runner: QueryRunner, s: Seed, lineId: string) => Promise<void>;
  }>;
  /** What the suite must leave as the screen leaves it. */
  state: (runner: QueryRunner, s: Seed, lineId: string) => Promise<unknown>;
  /** The suite ends where it started (it undoes all it did). */
  stateBefore?: boolean;
};

/** A version's allocation as stored: method, driver and rows. */
async function allocationState(runner: QueryRunner, s: Seed, lineId: string) {
  const versionId = await versionOf(runner, s, lineId);
  const [version] = await runner.query(`SELECT allocation_method, allocation_driver FROM spend_versions WHERE tenant_id = $1 AND id = $2`, [s.tenantId, versionId]);
  const rows = await runner.query(
    `SELECT company_id, department_id, allocation_pct::text AS pct FROM spend_allocations WHERE tenant_id = $1 AND version_id = $2 ORDER BY company_id`,
    [s.tenantId, versionId],
  );
  return { method: version.allocation_method, driver: version.allocation_driver, rows };
}

/** The 2026 budget column as stored: its twelve months and its record (how it was entered, its lines). */
async function plannedColumn(runner: QueryRunner, s: Seed, lineId: string) {
  const versionId = await versionOf(runner, s, lineId);
  const months = (await runner.query(
    `SELECT planned::text AS amount FROM spend_amounts WHERE tenant_id = $1 AND version_id = $2 AND period BETWEEN '2026-01-01' AND '2026-12-31' ORDER BY period`,
    [s.tenantId, versionId],
  )).map((row: { amount: string }) => row.amount);
  const [record] = await runner.query(
    `SELECT r.method, to_char(r.period_start, 'YYYY-MM-DD') AS period_start, to_char(r.period_end, 'YYYY-MM-DD') AS period_end,
            r.spread_profile_name, r.last_calculation, r.fte::text AS fte,
            (SELECT json_agg(json_build_object('label', l.label, 'quantity', l.quantity::text, 'unit_price', l.unit_price::text,
                                               'period_start', l.period_start, 'period_end', l.period_end) ORDER BY l.sort)
               FROM spend_round_input_lines l WHERE l.tenant_id = r.tenant_id AND l.round_input_id = r.id) AS lines
       FROM spend_round_inputs r WHERE r.tenant_id = $1 AND r.version_id = $2 AND r.measure = 'planned'`,
    [s.tenantId, versionId],
  );
  return { months, record: record ?? null };
}

/**
 * The same column, its last calculation and profile left aside: a column typed by hand keeps the
 * ones it had before (`markRoundsManual`), on the screen as by Kad.
 */
async function plannedColumnByHand(runner: QueryRunner, s: Seed, lineId: string) {
  const { months, record } = await plannedColumn(runner, s, lineId);
  return { months, record: record ? { ...record, last_calculation: '<kept>', spread_profile_name: '<kept>' } : null };
}

/** A split by company follows the companies' 2026 headcount. */
async function companyHeadcounts(runner: QueryRunner, s: Seed) {
  for (const [companyId, headcount] of [[s.companyId, 60], [s.secondCompanyId, 40]] as const) {
    await runner.query(`INSERT INTO company_metrics (tenant_id, company_id, fiscal_year, headcount, it_users, turnover)
                        VALUES ($1, $2, 2026, $3, 0, 0)`, [s.tenantId, companyId, headcount]);
  }
}

const financialCard = (lineId: string, input: Record<string, unknown>) => ({
  tool: 'write_financial_plan',
  input: { entity_type: 'budget_lines', ref: lineId, version_ref: 'Y2026', ...input },
});
/** The Allocations tab's save: method, driver and rows together. */
const allocationsTab = (nature: 'opex' | 'capex', method: string, rows: (s: Seed) => Array<Record<string, unknown>>) =>
  async (h: Harness, runner: QueryRunner, s: Seed, lineId: string) => {
    await h.services.allocations[nature].put(await versionOf(runner, s, lineId), { method, rows: rows(s), base_signature: null }, s.userId, screenOpts(runner, s));
  };
const twoCompanies = (s: Seed) => [{ company_id: s.companyId, department_id: null }, { company_id: s.secondCompanyId, department_id: null }];
const budgetTab = (payload: Record<string, unknown>) => async (h: Harness, runner: QueryRunner, s: Seed, lineId: string) => {
  await h.services.amounts.opex.bulkUpsert(await versionOf(runner, s, lineId), payload, s.userId, { manager: runner.manager });
};
const TWELVE_HUNDREDS = Array.from({ length: 12 }, (_, i) => ({ period: `2026-${String(i + 1).padStart(2, '0')}-01`, planned: 1000 }));
const LICENCE_LINES = [{
  label: 'Licences', quantity_unit: 'pieces', quantity: '10', unit_price: '100', price_basis: 'per_piece', frequency: 'per_month',
  period_start: '2026-01-01', period_end: '2026-12-31',
}];
/** A line whose 2026 budget column holds 12,000, entered as `payload` on the budget tab. */
const lineWithBudget = (payload: Record<string, unknown>) => async (h: Harness, runner: QueryRunner, s: Seed) => {
  const lineId = await lineWithVersion(h, runner, s);
  await budgetTab(payload)(h, runner, s, lineId);
  return lineId;
};

const SEQUENCES: SequenceCase[] = [
  // An allocation by company set by Kad, then undone: the rows go, as on the Allocations tab.
  ...(['opex', 'capex'] as const).map((nature): SequenceCase => ({
    name: `budget_lines (${nature}): manual allocation, two companies, undo`,
    prepare: async (h, runner, s) => {
      await companyHeadcounts(runner, s);
      return lineWithVersion(h, runner, s, nature);
    },
    steps: [
      { kad: (_s, id) => financialCard(id, { action: 'update_version', fields: { allocation_method: 'manual_company' } }), screen: allocationsTab(nature, 'manual_company', () => []) },
      { kad: (s, id) => financialCard(id, { action: 'replace_allocations', allocations: [s.companyId, s.secondCompanyId] }), screen: allocationsTab(nature, 'manual_company', twoCompanies) },
      { kad: { undo: 0 }, screen: allocationsTab(nature, 'default', () => []) },
    ],
    state: allocationState,
  })),
  {
    name: 'budget_lines: manual allocation, then back to the default method',
    prepare: async (h, runner, s) => {
      await companyHeadcounts(runner, s);
      return lineWithVersion(h, runner, s);
    },
    steps: [
      { kad: (_s, id) => financialCard(id, { action: 'update_version', fields: { allocation_method: 'manual_company' } }), screen: allocationsTab('opex', 'manual_company', () => []) },
      { kad: (s, id) => financialCard(id, { action: 'replace_allocations', allocations: [s.companyId, s.secondCompanyId] }), screen: allocationsTab('opex', 'manual_company', twoCompanies) },
      { kad: (_s, id) => financialCard(id, { action: 'update_version', fields: { allocation_method: 'default' } }), screen: allocationsTab('opex', 'default', () => []) },
    ],
    state: allocationState,
  },
];

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return String((await runner.query(sql, params))[0].id);
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR","default_spend_currency":"EUR","default_capex_currency":"EUR"}'::jsonb,
             '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `ai-history-${tag}`, `AI history ${tag}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const model = await one(runner,
    `INSERT INTO ai_model_configs (tenant_id, name, provider, model, endpoint_url, api_key_encrypted, supports_vision, is_default, created_at, updated_at)
     VALUES ($1, 'history-model', 'custom', 'history-model', 'https://llm.example.test/v1', 'test-secret', true, true, now(), now()) RETURNING id`, [tenantId]);
  await runner.query(
    `INSERT INTO ai_settings (tenant_id, chat_enabled, mcp_enabled, provider_source, llm_provider, llm_endpoint_url, llm_model,
                              llm_api_key_encrypted, web_search_enabled, glpi_enabled, chat_model_config_id, created_at, updated_at)
     VALUES ($1, true, true, 'custom', 'custom', 'https://llm.example.test/v1', 'history-model', 'test-secret', false, false, $2, now(), now())`,
    [tenantId, model]);
  const roleId = await one(runner,
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, 'History member', 'History member', false, false, now(), now()) RETURNING id`, [tenantId]);
  for (const [resource, level] of Object.entries(PERMISSIONS)) {
    await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level, created_at, updated_at) VALUES ($1, $2, $3, $4, now(), now())`,
      [tenantId, roleId, resource, level]);
  }
  const userId = await one(runner,
    `INSERT INTO users (tenant_id, first_name, last_name, email, role_id, mfa_enabled, status, locale, created_at, updated_at)
     VALUES ($1, 'Member', 'Tester', $2, $3, false, 'enabled', 'en', now(), now()) RETURNING id`,
    [tenantId, `member-${tag}@example.test`, roleId]);
  const chart = await one(runner, `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, $2, 'Chart', 'FR') RETURNING id`, [tenantId, `C${tag}`]);
  const companyId = await one(runner, `INSERT INTO companies (tenant_id, name, country_iso, city, coa_id) VALUES ($1, 'History company', 'FR', 'Lyon', $2) RETURNING id`, [tenantId, chart]);
  const secondCompanyId = await one(runner, `INSERT INTO companies (tenant_id, name, country_iso, city, coa_id) VALUES ($1, 'Second company', 'FR', 'Nantes', $2) RETURNING id`, [tenantId, chart]);
  const accountId = await one(runner, `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name) VALUES ($1, $2, 6100, 'Software') RETURNING id`, [tenantId, chart]);
  const supplierId = await one(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'History supplier') RETURNING id`, [tenantId]);
  const locationId = await one(runner,
    `INSERT INTO locations (tenant_id, location_reference, name, hosting_type) VALUES ($1, 'LOC-1', 'Paris DC', 'cloud') RETURNING id`, [tenantId]);
  // A project's, a request's and an interface's texts are their managed documents: the tenant needs their slots.
  await seedManagedDocsKnowledgeAssets(runner.manager as any, tenantId);
  const sourceAppId = await one(runner,
    `INSERT INTO applications (tenant_id, name, status) VALUES ($1, 'Orders', 'enabled') RETURNING id`, [tenantId]);
  const targetAppId = await one(runner,
    `INSERT INTO applications (tenant_id, name, status) VALUES ($1, 'Billing', 'enabled') RETURNING id`, [tenantId]);
  const sourceAssetId = await one(runner,
    `INSERT INTO assets (tenant_id, name, kind, environment, location_id) VALUES ($1, 'srv-orders', 'server', 'prod', $2) RETURNING id`, [tenantId, locationId]);
  const targetAssetId = await one(runner,
    `INSERT INTO assets (tenant_id, name, kind, environment, location_id) VALUES ($1, 'srv-billing', 'server', 'prod', $2) RETURNING id`, [tenantId, locationId]);
  return {
    tenantId, userId, userName: 'Member Tester', companyId, secondCompanyId, supplierId, accountId, locationId,
    sourceAppId, targetAppId, sourceAssetId, targetAssetId,
  };
}

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-record-write-history.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiToolRegistry } = require('../ai-tool.registry');
  const { AiMutationPreviewService } = require('../ai-mutation-preview.service');
  const { ApplicationsService } = require('../../applications/services/applications.service');
  const { AssetsService } = require('../../assets/services/assets.service');
  const { ContractsService } = require('../../contracts/contracts.service');
  const { BudgetLinesService } = require('../../spend/budget-lines.service');
  const { PortfolioProjectsService } = require('../../portfolio/services');
  const { PortfolioRequestsService } = require('../../portfolio/portfolio-requests.service');
  const { InterfacesService } = require('../../interfaces/services/interfaces.service');
  const { ConnectionsService } = require('../../connections/services/connections.service');
  const { NotificationsService } = require('../../notifications/notifications.service');
  const { SpendVersionsService, CapexVersionsService } = require('../../spend/spend-versions.service');
  const { SpendAmountsService, CapexAmountsService } = require('../../spend/spend-amounts.service');
  const { SpendAllocationsService, CapexAllocationsService } = require('../../spend/spend-allocations.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  // A project's or a request's change notifies people: nothing is sent from this spec.
  const notifications = app.get(NotificationsService, { strict: false });
  for (const method of ['notifyStatusChange', 'notifyTeamAdded', 'notifyItLeadOfTeamChange']) {
    notifications[method] = async () => undefined;
  }
  return {
    app,
    dataSource: app.get(DataSource),
    tools: app.get(AiToolRegistry),
    previews: app.get(AiMutationPreviewService),
    services: {
      applications: app.get(ApplicationsService, { strict: false }),
      assets: app.get(AssetsService, { strict: false }),
      contracts: app.get(ContractsService, { strict: false }),
      budgetLines: app.get(BudgetLinesService, { strict: false }),
      projects: app.get(PortfolioProjectsService, { strict: false }),
      requests: app.get(PortfolioRequestsService, { strict: false }),
      interfaces: app.get(InterfacesService, { strict: false }),
      connections: app.get(ConnectionsService, { strict: false }),
      versions: { opex: app.get(SpendVersionsService, { strict: false }), capex: app.get(CapexVersionsService, { strict: false }) },
      amounts: { opex: app.get(SpendAmountsService, { strict: false }), capex: app.get(CapexAmountsService, { strict: false }) },
      allocations: { opex: app.get(SpendAllocationsService, { strict: false }), capex: app.get(CapexAllocationsService, { strict: false }) },
    },
  };
}

function context(s: Seed, runner: QueryRunner, conversationId: string) {
  return {
    tenantId: s.tenantId, userId: s.userId, isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const,
    conversationId, manager: runner.manager,
  };
}

async function auditIds(runner: QueryRunner, s: Seed): Promise<Set<string>> {
  const rows: Array<{ id: string }> = await runner.query(`SELECT id FROM audit_log WHERE tenant_id = $1`, [s.tenantId]);
  return new Set(rows.map((row) => row.id));
}

/** The audit rows `write` adds. */
async function rowsWrittenBy(runner: QueryRunner, s: Seed, write: () => Promise<unknown>): Promise<AuditRow[]> {
  const known = await auditIds(runner, s);
  await write();
  const rows: AuditRow[] = await runner.query(
    `SELECT id, table_name, record_id, action, before_json, after_json, user_id, source, source_ref
     FROM audit_log WHERE tenant_id = $1 ORDER BY created_at, id`,
    [s.tenantId],
  );
  return rows.filter((row) => !known.has(row.id));
}

/** Values that differ between two plays of one gesture by nature: ids and write times (a managed document's publication). */
const VOLATILE_KEYS = new Set(['id', 'created_at', 'updated_at', 'published_at']);

/**
 * Fields that carry who wrote a row, beside its audit source: they belong to the attribution. An
 * operating-system link Kad writes is marked `ai` (`osSource`), the screen's `manual`.
 */
const PROVENANCE_KEYS: Record<string, ReadonlySet<string>> = {
  asset_technologies: new Set(['source']),
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The ids the seed made stay as they are; the record becomes `<record>`, any id the gesture made `<new>`. */
function neutralId(value: string, recordId: string, seedIds: ReadonlySet<string>): string {
  const id = value.toLowerCase();
  if (id === recordId) return '<record>';
  return seedIds.has(id) ? id : '<new>';
}

function neutral(value: unknown, recordId: string, seedIds: ReadonlySet<string>, ignored: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => neutral(item, recordId, seedIds, ignored));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !ignored.has(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, VOLATILE_KEYS.has(key) ? '<volatile>' : neutral(item, recordId, seedIds, ignored)]));
  }
  if (typeof value === 'string' && UUID.test(value)) return neutralId(value, recordId, seedIds);
  return value;
}

/** What a list of audit rows says, attribution set aside. */
function shapes(rows: AuditRow[], recordId: string, s: Seed): string[] {
  const seedIds = new Set(Object.values(s).filter((value) => UUID.test(value)).map((value) => value.toLowerCase()));
  return rows
    .map((row) => {
      const ignored = PROVENANCE_KEYS[row.table_name] ?? new Set<string>();
      return JSON.stringify({
        table: row.table_name,
        action: row.action,
        record: row.record_id ? neutralId(row.record_id, recordId, seedIds) : null,
        before: neutral(row.before_json, recordId, seedIds, ignored),
        after: neutral(row.after_json, recordId, seedIds, ignored),
      });
    })
    .sort();
}

function assertKadRows(name: string, rows: AuditRow[], table: string, recordId: string | null, previewId: string, s: Seed) {
  // `recordId` null: a child keyed by another id (a version's amounts), counted by its table.
  const own = rows.filter((row) => row.table_name === table && (recordId === null || row.record_id === recordId));
  assert.equal(own.length, 1, `${name}: one history line for the record (got ${own.length}: ${own.map((row) => row.source).join(', ')})`);
  for (const row of rows) {
    assert.deepEqual(
      { table: row.table_name, source: row.source, sourceRef: row.source_ref, user: row.user_id },
      { table: row.table_name, source: 'ai_chat', sourceRef: previewId, user: s.userId },
      `${name}: every row of the approval is Kad's, for the person who approved`,
    );
  }
}

async function history(runner: QueryRunner, s: Seed, table: string, recordId: string) {
  const { RecordHistoryService } = require('../../audit/record-history.service');
  const permissions = Object.fromEntries(Object.keys(PERMISSIONS).map((module) => [module, 'reader']));
  const page = await new RecordHistoryService().list(
    { tenantId: s.tenantId, userId: s.userId, isAdmin: false, permissions, manager: runner.manager },
    table,
    recordId,
    { limit: 100 },
  );
  return page.items as Array<{ id: string; action: string; actor: { kind: string; name: string | null }; subject: { kind: string; label?: string }; changes: unknown[] }>;
}

async function runCase(harness: Harness, entry: HistoryCase) {
  const runner = harness.dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const s = await seed(runner);
    const ctx = context(s, runner, randomUUID());
    await runner.query(
      `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at)
       VALUES ($1, $2, $3, 'AI record history', 'custom', 'history-model', 'custom', now(), now())`,
      [ctx.conversationId, s.tenantId, s.userId],
    );
    const prepared = entry.prepare ? await entry.prepare(harness, runner, s) : null;
    const { tool, input } = entry.card(s, prepared);
    const preview = await harness.tools.execute(ctx, tool, input) as any;
    assert.equal(preview.status, 'pending', `${entry.name}: ${JSON.stringify(preview)}`);
    const [stored] = await runner.query(`SELECT mutation_input FROM ai_mutation_previews WHERE id = $1`, [preview.preview_id]);
    const fields = { ...(stored.mutation_input.fields ?? {}) };

    const historyTable = entry.historyOf?.table ?? entry.table;
    const ownKind = entry.historyOf?.kind ?? 'record';
    const historyBefore = prepared ? await history(runner, s, historyTable, prepared) : [];
    const known = new Set(historyBefore.map((item) => item.id));

    // The screen's gesture, under a savepoint rolled back: the same state for Kad's.
    await runner.query('SAVEPOINT k2a_screen');
    let screenId = '';
    const screenRows = await rowsWrittenBy(runner, s, async () => {
      screenId = (await entry.screen(harness, runner, s, fields, prepared, stored.mutation_input)).toLowerCase();
    });
    const screenAdded = (await history(runner, s, historyTable, screenId)).filter((item) => !known.has(item.id));
    await runner.query('ROLLBACK TO SAVEPOINT k2a_screen');
    assert.ok(screenRows.length > 0, `${entry.name}: the screen writes its history`);

    const kadRows = await rowsWrittenBy(runner, s, async () => {
      const executed = await harness.previews.executePreview(ctx, preview.preview_id) as any;
      assert.equal(executed.status, 'executed', `${entry.name}: ${executed.error_message || 'the card did not execute'}`);
    });
    const [target] = await runner.query(`SELECT target_entity_id FROM ai_mutation_previews WHERE id = $1`, [preview.preview_id]);
    const recordId = String(target.target_entity_id).toLowerCase();

    const ownRecord = entry.historyOf ? null : recordId;
    assertKadRows(entry.name, kadRows, entry.table, ownRecord, preview.preview_id, s);
    assert.deepEqual(
      shapes(kadRows, recordId, s),
      shapes(screenRows, screenId, s),
      `${entry.name}: Kad's rows carry what the screen writes for the same gesture`,
    );

    // The History tab: the entries the screen's gesture adds (one about the record, plus its
    // children's, such as an asset's operating system), each one by Kad for the person.
    const added = (await history(runner, s, historyTable, recordId)).filter((item) => !known.has(item.id));
    const view = (items: typeof added) => items.map((item) => `${item.subject.kind}:${item.action}`).sort();
    assert.deepEqual(view(added), view(screenAdded), `${entry.name}: the History tab gets the entries the screen's gesture gives`);
    const own = added.filter((item) => item.subject.kind === ownKind);
    assert.equal(own.length, 1, `${entry.name}: one History entry about the ${ownKind} (got ${own.length})`);
    if (entry.historyOf && own[0].action === 'create') {
      // A child's creation (a budget version) is an entry with its title and no field changes, as on the screen.
      assert.ok(own[0].subject.label, `${entry.name}: the entry names the created ${ownKind}`);
    } else {
      assert.ok(own[0].changes.length > 0, `${entry.name}: the entry says what changed`);
    }
    for (const item of added) {
      assert.deepEqual(item.actor, { kind: 'assistant', name: s.userName }, `${entry.name}: each entry is by Kad for the person`);
    }

    if (entry.undo) {
      const reverse = await harness.previews.createReversePreview(ctx, preview.preview_id) as any;
      const undoRows = await rowsWrittenBy(runner, s, async () => {
        const executed = await harness.previews.executePreview(ctx, reverse.preview_id) as any;
        assert.equal(executed.status, 'executed', `${entry.name} (undo): ${executed.error_message || 'the undo did not execute'}`);
      });
      assertKadRows(`${entry.name} (undo)`, undoRows, entry.table, ownRecord, reverse.preview_id, s);
    }
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function runSequence(harness: Harness, entry: SequenceCase) {
  const runner = harness.dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const s = await seed(runner);
    const ctx = context(s, runner, randomUUID());
    await runner.query(
      `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at)
       VALUES ($1, $2, $3, 'AI record history', 'custom', 'history-model', 'custom', now(), now())`,
      [ctx.conversationId, s.tenantId, s.userId],
    );
    const lineId = (await entry.prepare(harness, runner, s)).toLowerCase();
    const before = await entry.state(runner, s, lineId);

    // The screen's suite, under a savepoint rolled back: the same state for Kad's.
    await runner.query('SAVEPOINT k2a_screen');
    const screenRows: AuditRow[] = [];
    for (const step of entry.steps) screenRows.push(...await rowsWrittenBy(runner, s, () => step.screen(harness, runner, s, lineId)));
    const screenState = await entry.state(runner, s, lineId);
    await runner.query('ROLLBACK TO SAVEPOINT k2a_screen');

    const previewIds: string[] = [];
    const kadRows: AuditRow[] = [];
    for (const [index, step] of entry.steps.entries()) {
      const at = `${entry.name}, step ${index + 1}`;
      let preview: any;
      if (typeof step.kad === 'function') {
        const { tool, input } = step.kad(s, lineId);
        preview = await harness.tools.execute(ctx, tool, input);
      } else {
        preview = await harness.previews.createReversePreview(ctx, previewIds[step.kad.undo]);
      }
      assert.equal(preview.status, 'pending', `${at}: ${JSON.stringify(preview)}`);
      previewIds.push(preview.preview_id);
      const rows = await rowsWrittenBy(runner, s, async () => {
        const executed = await harness.previews.executePreview(ctx, preview.preview_id) as any;
        assert.equal(executed.status, 'executed', `${at}: ${executed.error_message || 'the card did not execute'}`);
      });
      for (const row of rows) {
        assert.deepEqual(
          { table: row.table_name, source: row.source, sourceRef: row.source_ref, user: row.user_id },
          { table: row.table_name, source: 'ai_chat', sourceRef: preview.preview_id, user: s.userId },
          `${at}: every row of the approval is Kad's, for the person who approved`,
        );
      }
      kadRows.push(...rows);
    }

    assert.deepEqual(shapes(kadRows, lineId, s), shapes(screenRows, lineId, s), `${entry.name}: Kad's rows carry what the screen writes for the same suite`);
    const after = await entry.state(runner, s, lineId);
    assert.deepEqual(after, screenState, `${entry.name}: Kad leaves the line as the screen does`);
    if (entry.stateBefore) assert.deepEqual(after, before, `${entry.name}: the undo puts the line back as it was`);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function run() {
  const harness = await createHarness();
  try {
    const failures: string[] = [];
    for (const entry of CASES) {
      try {
        await runCase(harness, entry);
      } catch (error) {
        failures.push(`${entry.name}: ${(error as Error).message}`);
      }
    }
    for (const entry of SEQUENCES) {
      try {
        await runSequence(harness, entry);
      } catch (error) {
        failures.push(`${entry.name}: ${(error as Error).message}`);
      }
    }
    const total = CASES.length + SEQUENCES.length;
    if (failures.length) throw new Error(`${failures.length} of ${total} cases failed:\n${failures.join('\n\n')}`);
    console.log(`ai-record-write-history.integration.spec.ts passed (${total} cases)`);
  } finally {
    await harness.app.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
