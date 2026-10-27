import { BadRequestException, NotFoundException } from '@nestjs/common';
import { effectiveAssignmentsSql } from '../app-asset-assignments/effective-assignments';
import { EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import type { CsvLanguage } from '../common/csv-sheet';
import { typedTextRows, writeListExport, type ListExportFile } from '../common/csv/list-export';
import type { ExportFileFormat } from '../common/xlsx/format';
import { catalogFromMetadata, type ClassificationLevel } from '../it-ops-settings/classification-catalog';
import type { CatalogTranslations } from '../it-ops-settings/catalog-codes';
import { DEFAULT_HOSTING_TYPES } from '../it-ops-settings/it-ops-settings.service';

/**
 * The compliance register of the contracts: what a contract is expected to hold, and what the user
 * recorded for it. The screen helps keep the register; it makes no claim about regulatory compliance.
 *
 * - **Requirements**: a fixed list in v1 (`CONTRACT_COMPLIANCE_REQUIREMENTS`, stable codes). The
 *   table stores the code as text, so a list per tenant can come later without a migration.
 * - **Expected**: computed on the fly, never stored, from the applications the contract covers:
 *   the applications linked to it (`application_contracts`), and the applications with an instance
 *   on an asset the contract covers (`asset_contracts`, or the asset's support contract,
 *   `asset_support_info.support_contract_id`). An application past its end of validity counts no
 *   more. Each rule below makes requirements expected (`COMPLIANCE_RULE_REQUIREMENTS`), and gives
 *   its reason (the application, the asset it was reached through, the level or hosting type):
 *   - `personal_data`: the application holds personal data (`applications.contains_pii`);
 *   - `business_criticality`, `cyber_criticality`: the application's level is one of the
 *     `HIGH_LEVEL_COUNT` most severe levels of the tenant's catalog (by rank; the most severe alone
 *     when the catalog has fewer than three levels);
 *   - `cloud_hosting`: an instance of the application runs on an asset whose location's hosting type
 *     is in the cloud (the hosting type's category in the tenant's IT operations settings).
 * - **Recorded**: `contract_compliance_items`, one row per contract and requirement: the state
 *   (`present`, `absent`, `not_applicable`), a short reference, who and when. A requirement with
 *   neither has no row.
 * - **Summary** of a contract (`ComplianceSummary`): its expected requirements, those recorded
 *   absent (`missing`), those with no state (`to_check`), and the state the list shows: `missing`,
 *   then `to_check`, then `complete`; `none` when nothing is expected. The list sorts and filters on
 *   it on the server (`complianceSummarySql`, joined as `cc`).
 *
 * Every statement reads the session tenant (`app_current_tenant()`) besides RLS, by batch of
 * contract ids or for the whole tenant in one statement.
 */

export const CONTRACT_COMPLIANCE_REQUIREMENTS = ['gdpr_dpa', 'data_location', 'reversibility', 'exit_plan', 'audit_security'] as const;
export type ComplianceRequirement = (typeof CONTRACT_COMPLIANCE_REQUIREMENTS)[number];

export const COMPLIANCE_STATES = ['present', 'absent', 'not_applicable'] as const;
export type ComplianceState = (typeof COMPLIANCE_STATES)[number];

export const COMPLIANCE_RULES = ['personal_data', 'business_criticality', 'cyber_criticality', 'cloud_hosting'] as const;
export type ComplianceRule = (typeof COMPLIANCE_RULES)[number];

/** The requirements each rule makes expected (v1, the same for every tenant). */
export const COMPLIANCE_RULE_REQUIREMENTS: Record<ComplianceRule, ComplianceRequirement[]> = {
  personal_data: ['gdpr_dpa', 'data_location'],
  business_criticality: ['reversibility', 'exit_plan', 'audit_security'],
  cyber_criticality: ['reversibility', 'exit_plan', 'audit_security'],
  cloud_hosting: ['data_location'],
};

/** How many of the most severe levels of a criticality catalog count as high. */
export const HIGH_LEVEL_COUNT = 2;
/** The longest reference, in characters (also a check constraint of the table). */
export const COMPLIANCE_REFERENCE_MAX = 500;

export const COMPLIANCE_SUMMARY_STATES = ['missing', 'to_check', 'complete', 'none'] as const;
export type ComplianceSummaryState = (typeof COMPLIANCE_SUMMARY_STATES)[number];
export type ComplianceSummary = { expected: number; missing: number; to_check: number; state: ComplianceSummaryState };

/** The list's sort on the summary (joined as `cc`): none, complete, to check, then missing, by count. */
export const COMPLIANCE_SORT_EXPRESSION = '(cc.missing * 1000000 + cc.to_check * 1000 + cc.expected)';

type LevelAxis = 'businessCriticalityLevels' | 'cyberCriticalityLevels' | 'hostingTypes';
type CatalogEntry = { axis: LevelAxis; code: string; label: string; translations?: CatalogTranslations };

/** What the expectations read from the tenant's IT operations settings. */
export type ContractComplianceInputs = {
  highBusiness: string[];
  highCyber: string[];
  cloudHosting: string[];
  /** Names of the levels and hosting types, by `${axis}:${code}`, for the reasons. */
  entries: Map<string, CatalogEntry>;
};

export type ComplianceReason = {
  rule: ComplianceRule;
  application: { id: string; name: string };
  /** The covered asset the application was reached through; null when it is linked to the contract. */
  asset: { id: string; name: string } | null;
  /** The application's level, or the hosting type; null for personal data. */
  level: CatalogEntry | null;
};

export type ComplianceRequirementView = {
  requirement: ComplianceRequirement;
  expected: boolean;
  reasons: ComplianceReason[];
  state: ComplianceState | null;
  reference: string | null;
  updated_at: string | null;
  updated_by: { id: string; name: string | null } | null;
};

export type ContractComplianceView = { summary: ComplianceSummary; requirements: ComplianceRequirementView[] };

export function isComplianceRequirement(value: unknown): value is ComplianceRequirement {
  return typeof value === 'string' && (CONTRACT_COMPLIANCE_REQUIREMENTS as readonly string[]).includes(value);
}

/** The codes of the `HIGH_LEVEL_COUNT` most severe levels (the most severe alone below three levels). */
export function highLevelCodes(levels: Array<Pick<ClassificationLevel, 'code' | 'rank'>>): string[] {
  const count = levels.length >= 3 ? HIGH_LEVEL_COUNT : 1;
  return [...levels].sort((a, b) => b.rank - a.rank).slice(0, count).map((level) => level.code);
}

/** The tenant's catalogs as the expectations read them (defaults for a tenant that never customised them). */
export function complianceInputsFromSettings(itOps: Record<string, any> | null | undefined): ContractComplianceInputs {
  const raw = itOps ?? {};
  const catalog = catalogFromMetadata(raw);
  const entries = new Map<string, CatalogEntry>();
  const add = (axis: LevelAxis, item: { code: string; label: string; translations?: CatalogTranslations }) => {
    entries.set(`${axis}:${item.code}`, { axis, code: item.code, label: item.label, ...(item.translations ? { translations: item.translations } : {}) });
  };
  catalog.businessCriticalityLevels.forEach((level) => add('businessCriticalityLevels', level));
  catalog.cyberCriticalityLevels.forEach((level) => add('cyberCriticalityLevels', level));
  // A hosting type is in the cloud when its category says so; without a category, every code but
  // on_prem and colocation is (the settings' own reading, `normalizeHostingTypes`).
  const hosting: any[] = Array.isArray(raw.hosting_types) ? raw.hosting_types : DEFAULT_HOSTING_TYPES;
  const cloudHosting: string[] = [];
  for (const item of hosting) {
    const code = typeof item?.code === 'string' ? item.code.trim() : '';
    if (!code) continue;
    const category = item.category === 'on_prem' || item.category === 'cloud'
      ? item.category
      : (code === 'on_prem' || code === 'colocation' ? 'on_prem' : 'cloud');
    add('hostingTypes', { code, label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : code, translations: item.translations });
    if (category === 'cloud') cloudHosting.push(code);
  }
  return {
    highBusiness: highLevelCodes(catalog.businessCriticalityLevels),
    highCyber: highLevelCodes(catalog.cyberCriticalityLevels),
    cloudHosting,
    entries,
  };
}

export async function loadContractComplianceInputs(manager: EntityManager): Promise<ContractComplianceInputs> {
  const [row]: Array<{ it_ops: Record<string, any> | null }> = await manager.query(
    `SELECT metadata->'it_ops' AS it_ops FROM tenants WHERE id = app_current_tenant()`,
  );
  return complianceInputsFromSettings(row?.it_ops ?? null);
}

/** The bound parameters of the statements below (`cc` prefix, next to the budget's `cb`). */
export function complianceParams(inputs: ContractComplianceInputs, contractIds?: string[] | null): Record<string, unknown> {
  const ruleCodes: string[] = [];
  const ruleRequirements: string[] = [];
  for (const rule of COMPLIANCE_RULES) {
    for (const requirement of COMPLIANCE_RULE_REQUIREMENTS[rule]) {
      ruleCodes.push(rule);
      ruleRequirements.push(requirement);
    }
  }
  return {
    ccHighBusiness: inputs.highBusiness,
    ccHighCyber: inputs.highCyber,
    ccCloudHosting: inputs.cloudHosting,
    ccRuleCodes: ruleCodes,
    ccRuleRequirements: ruleRequirements,
    ...(contractIds ? { ccContractIds: contractIds } : {}),
  };
}

/**
 * One row per contract, expected requirement, rule, application (and level or hosting type): the
 * reasons. `scoped`: only the contracts of `:ccContractIds`; otherwise every contract of the tenant.
 */
export function complianceReasonsSql(scoped: boolean): string {
  const scope = scoped ? 'WHERE x.contract_id = ANY(CAST(:ccContractIds AS uuid[]))' : '';
  return `SELECT DISTINCT cov.contract_id, rq.requirement, r.rule, cov.application_id, a.name AS application_name,
           cov.asset_id, ast.name AS asset_name, r.level_code
      FROM (
        SELECT DISTINCT ON (x.contract_id, x.application_id) x.contract_id, x.application_id, x.asset_id
          FROM (
            SELECT l.contract_id, l.application_id, NULL::uuid AS asset_id
              FROM application_contracts l
             WHERE l.tenant_id = app_current_tenant()
            UNION ALL
            SELECT ca.contract_id, ai.application_id, ca.asset_id
              FROM (
                SELECT l.contract_id, l.asset_id FROM asset_contracts l WHERE l.tenant_id = app_current_tenant()
                UNION
                SELECT s.support_contract_id, s.asset_id FROM asset_support_info s
                 WHERE s.tenant_id = app_current_tenant() AND s.support_contract_id IS NOT NULL
              ) ca
              -- The applications running on the asset (effective: a member runs what its clusters carry).
              JOIN (${effectiveAssignmentsSql({ tenant: 'app_current_tenant()' })}) aaa ON aaa.tenant_id = app_current_tenant() AND aaa.asset_id = ca.asset_id
              JOIN app_instances ai ON ai.tenant_id = aaa.tenant_id AND ai.id = aaa.app_instance_id
          ) x
          ${scope}
         ORDER BY x.contract_id, x.application_id, x.asset_id NULLS FIRST
      ) cov
      JOIN applications a ON a.tenant_id = app_current_tenant() AND a.id = cov.application_id
                         AND (a.disabled_at IS NULL OR a.disabled_at > now())
      LEFT JOIN assets ast ON ast.tenant_id = app_current_tenant() AND ast.id = cov.asset_id
      CROSS JOIN LATERAL (
        SELECT 'personal_data'::text AS rule, NULL::text AS level_code WHERE a.contains_pii
        UNION ALL
        SELECT 'business_criticality', a.criticality WHERE a.criticality = ANY(CAST(:ccHighBusiness AS text[]))
        UNION ALL
        SELECT 'cyber_criticality', a.cyber_criticality WHERE a.cyber_criticality = ANY(CAST(:ccHighCyber AS text[]))
        UNION ALL
        SELECT DISTINCT 'cloud_hosting', loc.hosting_type
          FROM app_instances hi
          -- The servers the application runs on (effective: the members of a cluster give their site).
          JOIN (${effectiveAssignmentsSql({ tenant: 'a.tenant_id', applications: 'ARRAY[a.id]' })}) ha ON ha.tenant_id = hi.tenant_id AND ha.app_instance_id = hi.id
          JOIN assets hs ON hs.tenant_id = hi.tenant_id AND hs.id = ha.asset_id
          JOIN locations loc ON loc.tenant_id = hi.tenant_id AND loc.id = hs.location_id
         WHERE hi.tenant_id = a.tenant_id AND hi.application_id = a.id
           AND loc.hosting_type = ANY(CAST(:ccCloudHosting AS text[]))
      ) r
      JOIN unnest(CAST(:ccRuleCodes AS text[]), CAST(:ccRuleRequirements AS text[])) AS rq(rule, requirement)
        ON rq.rule = r.rule`;
}

/**
 * One row per contract (`contract_id`, `expected`, `missing`, `to_check`, `state`): the summary.
 * `scoped`: only the contracts of `:ccContractIds`; otherwise every contract of the tenant (the
 * list's `cc`, to sort and filter on).
 */
export function complianceSummarySql(scoped: boolean): string {
  const scope = scoped ? 'AND c.id = ANY(CAST(:ccContractIds AS uuid[]))' : '';
  const expected = 'count(e.requirement)';
  const missing = `count(e.requirement) FILTER (WHERE i.state = 'absent')`;
  const toCheck = `count(e.requirement) FILTER (WHERE i.state IS NULL)`;
  return `SELECT c.id AS contract_id,
           ${expected}::int AS expected,
           ${missing}::int AS missing,
           ${toCheck}::int AS to_check,
           CASE WHEN ${expected} = 0 THEN 'none'
                WHEN ${missing} > 0 THEN 'missing'
                WHEN ${toCheck} > 0 THEN 'to_check'
                ELSE 'complete' END AS state
      FROM contracts c
      LEFT JOIN (SELECT DISTINCT rr.contract_id, rr.requirement FROM (${complianceReasonsSql(scoped)}) rr) e
        ON e.contract_id = c.id
      LEFT JOIN contract_compliance_items i
        ON i.tenant_id = c.tenant_id AND i.contract_id = c.id AND i.requirement = e.requirement
     WHERE c.tenant_id = app_current_tenant() ${scope}
     GROUP BY c.id`;
}

type ReasonRow = {
  contract_id: string;
  requirement: ComplianceRequirement;
  rule: ComplianceRule;
  application_id: string;
  application_name: string;
  asset_id: string | null;
  asset_name: string | null;
  level_code: string | null;
};

const RULE_AXIS: Record<ComplianceRule, LevelAxis | null> = {
  personal_data: null,
  business_criticality: 'businessCriticalityLevels',
  cyber_criticality: 'cyberCriticalityLevels',
  cloud_hosting: 'hostingTypes',
};

function presentReason(inputs: ContractComplianceInputs, row: ReasonRow): ComplianceReason {
  const axis = RULE_AXIS[row.rule];
  const level = axis && row.level_code
    ? inputs.entries.get(`${axis}:${row.level_code}`) ?? { axis, code: row.level_code, label: row.level_code }
    : null;
  return {
    rule: row.rule,
    application: { id: row.application_id, name: row.application_name },
    asset: row.asset_id ? { id: row.asset_id, name: row.asset_name ?? '' } : null,
    level,
  };
}

/** The reasons of the contracts `contractIds` (null: every contract of the tenant), by contract then requirement. */
export async function readComplianceReasons(
  manager: EntityManager,
  inputs: ContractComplianceInputs,
  contractIds: string[] | null,
): Promise<Map<string, Map<ComplianceRequirement, ComplianceReason[]>>> {
  const result = new Map<string, Map<ComplianceRequirement, ComplianceReason[]>>();
  if (contractIds && contractIds.length === 0) return result;
  const rows: ReasonRow[] = await manager
    .createQueryBuilder()
    .select('rr.*')
    .from(`(${complianceReasonsSql(contractIds !== null)})`, 'rr')
    .setParameters(complianceParams(inputs, contractIds))
    .getRawMany();
  // Within an application, the rules in their listed order.
  const ruleOrder = new Map<string, number>(COMPLIANCE_RULES.map((rule, index) => [rule, index]));
  const text = (value: string | null) => value ?? '';
  rows.sort((a, b) => text(a.contract_id).localeCompare(text(b.contract_id))
    || text(a.application_name).localeCompare(text(b.application_name))
    || text(a.application_id).localeCompare(text(b.application_id))
    || (ruleOrder.get(a.rule) ?? 0) - (ruleOrder.get(b.rule) ?? 0)
    || text(a.level_code).localeCompare(text(b.level_code)));
  for (const row of rows) {
    if (!isComplianceRequirement(row.requirement)) continue;
    let byRequirement = result.get(row.contract_id);
    if (!byRequirement) result.set(row.contract_id, (byRequirement = new Map()));
    const list = byRequirement.get(row.requirement) ?? [];
    list.push(presentReason(inputs, row));
    byRequirement.set(row.requirement, list);
  }
  return result;
}

/** The summaries of the contracts `contractIds`, by contract id (one statement). */
export async function readComplianceSummaries(
  manager: EntityManager,
  inputs: ContractComplianceInputs,
  contractIds: string[],
): Promise<Map<string, ComplianceSummary>> {
  if (contractIds.length === 0) return new Map();
  const rows: Array<{ contract_id: string; expected: number | string; missing: number | string; to_check: number | string; state: ComplianceSummaryState }> = await manager
    .createQueryBuilder()
    .select('cs.*')
    .from(`(${complianceSummarySql(true)})`, 'cs')
    .setParameters(complianceParams(inputs, contractIds))
    .getRawMany();
  return new Map(rows.map((row) => [row.contract_id, {
    expected: Number(row.expected),
    missing: Number(row.missing),
    to_check: Number(row.to_check),
    state: row.state,
  }]));
}

/** The summary of requirements already read (the same rule as `complianceSummarySql`). */
export function summarizeCompliance(requirements: Array<Pick<ComplianceRequirementView, 'expected' | 'state'>>): ComplianceSummary {
  const expected = requirements.filter((item) => item.expected);
  const missing = expected.filter((item) => item.state === 'absent').length;
  const toCheck = expected.filter((item) => item.state === null).length;
  const state: ComplianceSummaryState = expected.length === 0 ? 'none' : missing > 0 ? 'missing' : toCheck > 0 ? 'to_check' : 'complete';
  return { expected: expected.length, missing, to_check: toCheck, state };
}

type ItemRow = {
  id: string;
  contract_id: string;
  requirement: string;
  state: ComplianceState | null;
  reference: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
  updated_at: Date | string;
  created_at: Date | string;
};

/** What was recorded for the contracts `contractIds` (null: every contract of the tenant), by contract then requirement. */
async function readComplianceItems(manager: EntityManager, contractIds: string[] | null): Promise<Map<string, Map<string, ItemRow>>> {
  const rows: ItemRow[] = await manager.query(
    `SELECT i.id, i.contract_id, i.requirement, i.state, i.reference, i.updated_by, i.updated_at, i.created_at,
            NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), '') AS updated_by_name
       FROM contract_compliance_items i
       LEFT JOIN users u ON u.tenant_id = i.tenant_id AND u.id = i.updated_by
      WHERE i.tenant_id = app_current_tenant()${contractIds ? ' AND i.contract_id = ANY($1::uuid[])' : ''}`,
    contractIds ? [contractIds] : [],
  );
  const result = new Map<string, Map<string, ItemRow>>();
  for (const row of rows) {
    let byRequirement = result.get(row.contract_id);
    if (!byRequirement) result.set(row.contract_id, (byRequirement = new Map()));
    byRequirement.set(row.requirement, row);
  }
  return result;
}

const iso = (value: Date | string | null | undefined): string | null => (value == null ? null : new Date(value).toISOString());

function requirementViews(
  reasons: Map<ComplianceRequirement, ComplianceReason[]> | undefined,
  items: Map<string, ItemRow> | undefined,
): ComplianceRequirementView[] {
  return CONTRACT_COMPLIANCE_REQUIREMENTS.map((requirement) => {
    const why = reasons?.get(requirement) ?? [];
    const item = items?.get(requirement);
    return {
      requirement,
      expected: why.length > 0,
      reasons: why,
      state: item?.state ?? null,
      reference: item?.reference ?? null,
      updated_at: item ? iso(item.updated_at) : null,
      updated_by: item?.updated_by ? { id: item.updated_by, name: item.updated_by_name } : null,
    };
  });
}

/** The Compliance tab of a contract: every requirement, expected or not, with its reasons and what was recorded. */
export async function contractComplianceView(
  manager: EntityManager,
  inputs: ContractComplianceInputs,
  contract: { id: string },
): Promise<ContractComplianceView> {
  // One after the other: the request's single connection runs its queries in turn anyway.
  const reasons = await readComplianceReasons(manager, inputs, [contract.id]);
  const items = await readComplianceItems(manager, [contract.id]);
  const requirements = requirementViews(reasons.get(contract.id), items.get(contract.id));
  return { summary: summarizeCompliance(requirements), requirements };
}

export type ComplianceItemPatch = { state?: unknown; reference?: unknown };

/**
 * Records the state and / or the reference of one requirement of a contract. A field left out of
 * the body is kept; `null` (or an empty reference) clears it. A requirement with neither left has no
 * row. The contract's row is locked first (FOR NO KEY UPDATE), so two writes of the same contract
 * run one after the other and the audit row matches what is stored. One audit row on
 * `contract_compliance_items` per write that changes something, before and after the row.
 */
export async function updateContractComplianceItem(
  deps: { manager: EntityManager; audit: Pick<AuditService, 'log'> },
  contract: { id: string; tenant_id: string },
  requirement: string,
  body: ComplianceItemPatch | null | undefined,
  userId: string | null,
): Promise<void> {
  const { manager } = deps;
  if (!isComplianceRequirement(requirement)) throw new BadRequestException('Unknown requirement.');
  const patch = body ?? {};
  const hasState = Object.prototype.hasOwnProperty.call(patch, 'state');
  const hasReference = Object.prototype.hasOwnProperty.call(patch, 'reference');
  if (!hasState && !hasReference) throw new BadRequestException('state or reference is required.');
  let nextState: ComplianceState | null | undefined;
  if (hasState) {
    const raw = patch.state;
    if (raw === null || raw === '') nextState = null;
    else if (typeof raw === 'string' && (COMPLIANCE_STATES as readonly string[]).includes(raw)) nextState = raw as ComplianceState;
    else throw new BadRequestException('state must be present, absent, not_applicable or null.');
  }
  let nextReference: string | null | undefined;
  if (hasReference) {
    const raw = patch.reference;
    if (raw === null) nextReference = null;
    else if (typeof raw === 'string') nextReference = raw.trim() || null;
    else throw new BadRequestException('reference must be a text or null.');
    if (nextReference && nextReference.length > COMPLIANCE_REFERENCE_MAX) {
      throw new BadRequestException(`reference must be at most ${COMPLIANCE_REFERENCE_MAX} characters.`);
    }
  }

  const locked = await manager.query(
    `SELECT 1 FROM contracts WHERE tenant_id = $1 AND id = $2 FOR NO KEY UPDATE`,
    [contract.tenant_id, contract.id],
  );
  if (locked.length === 0) throw new NotFoundException('Contract not found.');
  const [existing]: Array<Omit<ItemRow, 'updated_by_name'>> = await manager.query(
    `SELECT id, contract_id, requirement, state, reference, updated_by, updated_at, created_at
       FROM contract_compliance_items
      WHERE tenant_id = $1 AND contract_id = $2 AND requirement = $3`,
    [contract.tenant_id, contract.id, requirement],
  );
  const state = nextState === undefined ? existing?.state ?? null : nextState;
  const reference = nextReference === undefined ? existing?.reference ?? null : nextReference;
  if (state === (existing?.state ?? null) && reference === (existing?.reference ?? null)) return;

  const columns = 'id, tenant_id, contract_id, requirement, state, reference, updated_by, updated_at, created_at';
  if (state === null && reference === null) {
    await manager.query(`DELETE FROM contract_compliance_items WHERE tenant_id = $1 AND id = $2`, [contract.tenant_id, existing!.id]);
    await deps.audit.log(
      { table: 'contract_compliance_items', recordId: existing!.id, action: 'delete', before: existing, after: null, userId },
      { manager },
    );
    return;
  }
  if (existing) {
    const [after] = await manager.query(
      `UPDATE contract_compliance_items SET state = $3, reference = $4, updated_by = $5, updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING ${columns}`,
      [contract.tenant_id, existing.id, state, reference, userId],
    );
    await deps.audit.log(
      { table: 'contract_compliance_items', recordId: existing.id, action: 'update', before: existing, after: rowOf(after), userId },
      { manager },
    );
    return;
  }
  const [created] = await manager.query(
    `INSERT INTO contract_compliance_items (tenant_id, contract_id, requirement, state, reference, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${columns}`,
    [contract.tenant_id, contract.id, requirement, state, reference, userId],
  );
  const after = rowOf(created);
  await deps.audit.log(
    { table: 'contract_compliance_items', recordId: after.id, action: 'create', before: null, after, userId },
    { manager },
  );
}

/** `manager.query` returns the rows of a RETURNING clause, or `[rows, count]` for an UPDATE. */
function rowOf(result: any): Record<string, any> {
  return Array.isArray(result) ? result[0] : result;
}

// ----- The register (CSV): contract × requirement, in the screen's language -----

type RegisterCopy = {
  headers: [string, string, string, string, string, string, string, string, string, string];
  requirements: Record<ComplianceRequirement, string>;
  states: Record<ComplianceState | 'to_check', string>;
  yes: string;
  no: string;
  reasons: Record<ComplianceRule, string>;
  viaAsset: string;
};

/** The register's words, the same as the screen's (`contracts.compliance.*` in the `ops` locale files). */
const REGISTER_COPY: Record<CsvLanguage, RegisterCopy> = {
  en: {
    headers: ['Contract', 'Supplier', 'Company', 'Requirement', 'Expected', 'Reason', 'State', 'Reference', 'Updated on', 'Updated by'],
    requirements: {
      gdpr_dpa: 'GDPR data processing agreement (art. 28)',
      data_location: 'Data location',
      reversibility: 'Reversibility clause',
      exit_plan: 'Exit plan',
      audit_security: 'Audit rights and security clauses',
    },
    states: { present: 'Present', absent: 'Missing', not_applicable: 'Not applicable', to_check: 'To check' },
    yes: 'Yes',
    no: 'No',
    reasons: {
      personal_data: '{app} holds personal data',
      business_criticality: '{app}: business criticality {level}',
      cyber_criticality: '{app}: cyber criticality {level}',
      cloud_hosting: '{app}: hosted in {level}',
    },
    viaAsset: ' (asset {asset})',
  },
  fr: {
    headers: ['Contrat', 'Fournisseur', 'Société', 'Exigence', 'Attendue', 'Raison', 'État', 'Référence', 'Mis à jour le', 'Mis à jour par'],
    requirements: {
      gdpr_dpa: 'Accord de sous-traitance RGPD (art. 28)',
      data_location: 'Localisation des données',
      reversibility: 'Clause de réversibilité',
      exit_plan: 'Plan de sortie',
      audit_security: "Droit d'audit et clauses de sécurité",
    },
    states: { present: 'Présente', absent: 'Absente', not_applicable: 'Sans objet', to_check: 'À vérifier' },
    yes: 'Oui',
    no: 'Non',
    reasons: {
      personal_data: '{app} contient des données personnelles',
      business_criticality: '{app} : criticité métier {level}',
      cyber_criticality: '{app} : criticité cyber {level}',
      cloud_hosting: '{app} : hébergement {level}',
    },
    viaAsset: ' (actif {asset})',
  },
  de: {
    headers: ['Vertrag', 'Lieferant', 'Unternehmen', 'Anforderung', 'Erwartet', 'Grund', 'Status', 'Referenz', 'Aktualisiert am', 'Aktualisiert von'],
    requirements: {
      gdpr_dpa: 'Auftragsverarbeitungsvertrag nach DSGVO (Art. 28)',
      data_location: 'Speicherort der Daten',
      reversibility: 'Reversibilitätsklausel',
      exit_plan: 'Exit-Plan',
      audit_security: 'Auditrecht und Sicherheitsklauseln',
    },
    states: { present: 'Vorhanden', absent: 'Fehlt', not_applicable: 'Nicht zutreffend', to_check: 'Zu prüfen' },
    yes: 'Ja',
    no: 'Nein',
    reasons: {
      personal_data: '{app} enthält personenbezogene Daten',
      business_criticality: '{app}: geschäftliche Kritikalität {level}',
      cyber_criticality: '{app}: Cyber-Kritikalität {level}',
      cloud_hosting: '{app}: Hosting {level}',
    },
    viaAsset: ' (Asset {asset})',
  },
  es: {
    headers: ['Contrato', 'Proveedor', 'Empresa', 'Requisito', 'Esperado', 'Motivo', 'Estado', 'Referencia', 'Actualizado el', 'Actualizado por'],
    requirements: {
      gdpr_dpa: 'Contrato de encargado del tratamiento RGPD (art. 28)',
      data_location: 'Ubicación de los datos',
      reversibility: 'Cláusula de reversibilidad',
      exit_plan: 'Plan de salida',
      audit_security: 'Derecho de auditoría y cláusulas de seguridad',
    },
    states: { present: 'Presente', absent: 'Ausente', not_applicable: 'No aplica', to_check: 'Por verificar' },
    yes: 'Sí',
    no: 'No',
    reasons: {
      personal_data: '{app} contiene datos personales',
      business_criticality: '{app}: criticidad de negocio {level}',
      cyber_criticality: '{app}: criticidad cibernética {level}',
      cloud_hosting: '{app}: alojamiento {level}',
    },
    viaAsset: ' (activo {asset})',
  },
};

/** A reason in words: the tenant's translation of the level when it has one, else its name. */
export function registerReasonText(language: CsvLanguage, reason: ComplianceReason): string {
  const copy = REGISTER_COPY[language];
  const level = reason.level ? reason.level.translations?.[language]?.label || reason.level.label : '';
  const text = copy.reasons[reason.rule].replace('{app}', reason.application.name).replace('{level}', level);
  return reason.asset ? text + copy.viaAsset.replace('{asset}', reason.asset.name) : text;
}

export type RegisterContract = { id: string; name: string; supplier_name: string | null; company_name: string | null };

/** The sheet of the register's workbook. */
const REGISTER_SHEET: Record<CsvLanguage, string> = {
  en: 'Compliance register',
  fr: 'Registre de conformité',
  de: 'Konformitätsregister',
  es: 'Registro de conformidad',
};

/**
 * The register of `contracts` (in their order): one line per contract and requirement, expected or
 * not, with its reasons, what was recorded and who recorded it last. Three statements whatever the
 * number of contracts (reasons and records of the whole tenant, read once). CSV (the day of the last
 * update as `YYYY-MM-DD` in every language), or a workbook where that day is a date.
 */
export async function complianceRegisterFile<F extends ExportFileFormat>(
  manager: EntityManager,
  inputs: ContractComplianceInputs,
  contracts: RegisterContract[],
  language: CsvLanguage,
  format: F,
): Promise<ListExportFile<F>> {
  const copy = REGISTER_COPY[language];
  // One after the other: the request's single connection runs its queries in turn anyway.
  const reasons = await readComplianceReasons(manager, inputs, null);
  const items = await readComplianceItems(manager, null);
  const rows: string[][] = [];
  for (const contract of contracts) {
    for (const view of requirementViews(reasons.get(contract.id), items.get(contract.id))) {
      const state = view.state ? copy.states[view.state] : view.expected ? copy.states.to_check : '';
      rows.push([
        contract.name,
        contract.supplier_name ?? '',
        contract.company_name ?? '',
        copy.requirements[view.requirement],
        view.expected ? copy.yes : copy.no,
        view.reasons.map((reason) => registerReasonText(language, reason)).join('; '),
        state,
        view.reference ?? '',
        view.updated_at ? view.updated_at.slice(0, 10) : '',
        view.updated_by?.name ?? '',
      ]);
    }
  }
  return writeListExport({
    format,
    language,
    filename: 'contract-compliance-register.csv',
    sheetNames: REGISTER_SHEET,
    headers: copy.headers,
    // Updated on.
    rows: typedTextRows(format, rows, { 8: 'date' }),
  });
}
