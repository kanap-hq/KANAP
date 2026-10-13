import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ICU_COLLATION } from '../list-engine/sql-fragments';
import { ACTIVE_BY_DISABLED_AT, Bind, LookupRequest, LookupSpec, parseLookupRequest, runLookup } from './reference-lookup';

/**
 * The reference lookups of KANAP, one spec per table (see `reference-lookup.ts`).
 * Each controller exposes its own as `GET /<resource>/lookup?q=&limit=&ids=`.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An optional uuid parameter: absent is null, malformed is a 400 (it must not reach a uuid cast). */
function optionalUuid(value: unknown, name: string): string | null {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) return null;
  if (!UUID_RE.test(raw)) throw new BadRequestException(`${name} must be a uuid.`);
  return raw;
}

export const SUPPLIER_LOOKUP: LookupSpec = {
  table: 'suppliers',
  columns: { id: 't.id', name: 't.name', erp_supplier_id: 't.erp_supplier_id', status: 't.status' },
  label: 't.name',
  search: ['t.erp_supplier_id'],
  offered: ACTIVE_BY_DISABLED_AT,
};

export const COMPANY_LOOKUP: LookupSpec = {
  table: 'companies',
  columns: { id: 't.id', name: 't.name' },
  label: 't.name',
  offered: ACTIVE_BY_DISABLED_AT,
};

export const DEPARTMENT_LOOKUP: LookupSpec = {
  table: 'departments',
  columns: { id: 't.id', name: 't.name', company_id: 't.company_id' },
  label: 't.name',
  offered: ACTIVE_BY_DISABLED_AT,
};

/** Accounts sort by number, as a chart of accounts reads; a number typed finds its account first. */
export const ACCOUNT_LOOKUP: LookupSpec = {
  table: 'accounts',
  columns: {
    id: 't.id',
    account_number: 't.account_number',
    account_name: 't.account_name',
    description: 't.description',
    coa_id: 't.coa_id',
    nature: 't.nature',
  },
  label: 't.account_name',
  prefixes: ['t.account_number::text'],
  search: ['t.account_number::text', 't.native_name', 't.description'],
  sort: ['t.account_number', `t.account_name COLLATE ${ICU_COLLATION}`],
  offered: ACTIVE_BY_DISABLED_AT,
};

/** "First Last" as every picker shows a person; blank names fall back to the email (degraded case). */
const USER_FULL_NAME = "btrim(coalesce(t.first_name, '') || ' ' || coalesce(t.last_name, ''))";
const USER_NAMELESS = `${USER_FULL_NAME} = ''`;

/** A person's name as compared for sameness: first and last name each trimmed, case-insensitive. */
function userNameKey(alias: string): string {
  return `lower(btrim(coalesce(btrim(${alias}.first_name), '') || ' ' || coalesce(btrim(${alias}.last_name), '')))`;
}

/**
 * True when another account of the same tenant bears the same name as the
 * `users` row aliased `alias` (one person with a user and an admin account,
 * or accounts on two domains). Any status counts: a stored assignee can be a
 * disabled account, and a label must read the same everywhere. A nameless row
 * is never "shared" (it already shows its email). Used by the people lookup
 * below and by the knowledge contributor options (`knowledge.service.ts`).
 */
export function userNameSharedSql(alias: string): string {
  const key = userNameKey(alias);
  return `(${key} <> '' AND EXISTS (SELECT 1 FROM users same_name WHERE same_name.tenant_id = ${alias}.tenant_id AND same_name.id <> ${alias}.id AND ${userNameKey('same_name')} = ${key}))`;
}

/** The email shown, and searched, in place of the name: a person without a name, or whose name another account shares. */
const USER_SHOWN_EMAIL = `CASE WHEN ${USER_NAMELESS} OR ${userNameSharedSql('t')} THEN t.email END`;

/**
 * People: names only, searched on "first last" and "last first", sorted by last
 * name (the pickers' order). The email is returned only for a person without
 * a name, or whose name another account shares: the cases a picker shows it
 * instead of the name. Only that email is searched, so a person with a unique
 * name is not found by email.
 */
export const USER_LOOKUP: LookupSpec = {
  table: 'users',
  columns: {
    id: 't.id',
    first_name: 't.first_name',
    last_name: 't.last_name',
    email: USER_SHOWN_EMAIL,
    status: 't.status',
  },
  label: USER_FULL_NAME,
  prefixes: ['t.last_name'],
  search: ["btrim(coalesce(t.last_name, '') || ' ' || coalesce(t.first_name, ''))", USER_SHOWN_EMAIL],
  sort: [
    `coalesce(nullif(btrim(t.last_name), ''), nullif(btrim(t.first_name), ''), t.email) COLLATE ${ICU_COLLATION}`,
    `coalesce(t.first_name, '') COLLATE ${ICU_COLLATION}`,
  ],
  offered: "t.status = 'enabled'",
};

/**
 * One dimension's values (`axis_id`), in the dimension's order (position, then name); a text typed
 * keeps its rank first, as the accounts lookup.
 */
export const ANALYTICS_VALUE_LOOKUP: LookupSpec = {
  table: 'analytics_categories',
  columns: {
    id: 't.id',
    axis_id: 't.axis_id',
    name: 't.name',
    description: 't.description',
    applies_to: 't.applies_to',
    status: 't.status',
    sort_order: 't.sort_order',
  },
  label: 't.name',
  search: ['t.description'],
  sort: ['t.sort_order', `t.name COLLATE ${ICU_COLLATION}`],
  offered: ACTIVE_BY_DISABLED_AT,
};

export const BUSINESS_PROCESS_LOOKUP: LookupSpec = {
  table: 'business_processes',
  columns: { id: 't.id', name: 't.name', status: 't.status' },
  label: 't.name',
  offered: ACTIVE_BY_DISABLED_AT,
};

export const CONTRACT_LOOKUP: LookupSpec = {
  table: 'contracts',
  columns: { id: 't.id', name: 't.name' },
  label: 't.name',
  offered: ACTIVE_BY_DISABLED_AT,
};

type LookupCall = { manager?: EntityManager; tenantId: string };

async function lookup(call: LookupCall, spec: LookupSpec, request: LookupRequest) {
  if (!call.manager) throw new BadRequestException('Missing request transaction.');
  return runLookup(call.manager, call.tenantId, spec, request);
}

/** Plain lookups: no scope besides the tenant and the lifecycle. */
export async function lookupReference(call: LookupCall, spec: LookupSpec, query: any) {
  return lookup(call, spec, parseLookupRequest(query));
}

/** Departments, of one company when `company_id` is given. */
export async function lookupDepartments(call: LookupCall, query: any) {
  const request = parseLookupRequest(query);
  const companyId = optionalUuid(query?.company_id ?? query?.companyId, 'company_id');
  if (companyId) request.scope = [(bind: Bind) => `t.company_id = ${bind(companyId, 'uuid')}`];
  return lookup(call, DEPARTMENT_LOOKUP, request);
}

/** An optional line type (`opex`, `capex`) in the parameter `param`: absent is null, anything else a 400. */
function optionalLineType(value: unknown, param: string): 'opex' | 'capex' | null {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) return null;
  if (raw !== 'opex' && raw !== 'capex') throw new BadRequestException(`${param} must be 'opex' or 'capex'.`);
  return raw;
}

/**
 * Accounts of a company's chart (`companyId`): the company's own chart, else
 * the tenant's global default chart, else the accounts outside any chart, as
 * the accounts list scopes them. `coaId` names a chart directly. `nature`
 * (`opex`, `capex`) offers the accounts a line of that type may use: those of
 * that nature and those for both (NULL). Hydration by `ids` ignores it, so a
 * stored account of the other type still shows.
 */
export async function lookupAccounts(call: LookupCall, query: any) {
  const request = parseLookupRequest(query);
  const companyId = optionalUuid(query?.companyId ?? query?.company_id, 'companyId');
  const coaId = optionalUuid(query?.coaId ?? query?.coa_id, 'coaId');
  const nature = optionalLineType(query?.nature, 'nature');
  request.scope = [];
  if (companyId) {
    request.scope.push((bind: Bind) => {
      const tenant = bind(call.tenantId, 'uuid');
      return `t.coa_id IS NOT DISTINCT FROM coalesce(
        (SELECT c.coa_id FROM companies c WHERE c.tenant_id = ${tenant} AND c.id = ${bind(companyId, 'uuid')}),
        (SELECT g.id FROM chart_of_accounts g WHERE g.tenant_id = ${tenant} AND g.is_global_default = true ORDER BY g.id LIMIT 1))`;
    });
  } else if (coaId) {
    request.scope.push((bind: Bind) => `t.coa_id = ${bind(coaId, 'uuid')}`);
  }
  if (nature) request.scope.push((bind: Bind) => `t.nature IS NULL OR t.nature = ${bind(nature, 'text')}`);
  return lookup(call, ACCOUNT_LOOKUP, request);
}

/**
 * One dimension's values when `axis_id` is given. `applies_to` (`opex`, `capex`) offers the values
 * a line of that type may choose: those for that type and those for both (NULL). Hydration by
 * `ids` ignores it, so a held value of the other type still shows.
 */
export async function lookupAnalyticsValues(call: LookupCall, query: any) {
  const request = parseLookupRequest(query);
  const axisId = optionalUuid(query?.axis_id, 'axis_id');
  const appliesTo = optionalLineType(query?.applies_to, 'applies_to');
  request.scope = [];
  if (axisId) request.scope.push((bind: Bind) => `t.axis_id = ${bind(axisId, 'uuid')}`);
  if (appliesTo) request.scope.push((bind: Bind) => `t.applies_to IS NULL OR t.applies_to = ${bind(appliesTo, 'text')}`);
  return lookup(call, ANALYTICS_VALUE_LOOKUP, request);
}
