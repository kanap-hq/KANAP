import { EntityManager } from 'typeorm';
import {
  AnalyticsAxisInfo,
  ANALYTICS_CSV_PREFIX,
  analyticsFieldKey,
  axisAppliesTo,
  isAxisActive,
  loadAnalyticsAxes,
} from '../../../analytics/analytics-axes.util';
import { AiEntityFilterRegistry, AiFilterFieldDef, AiQueryEntityType, AiWithheldField } from '../ai-filter.types';
import { accountsRegistry } from './accounts.registry';
import { analyticsCategoriesRegistry } from './analytics-categories.registry';
import { applicationsRegistry } from './applications.registry';
import { assetsRegistry } from './assets.registry';
import { budgetLinesRegistry } from './budget-lines.registry';
import { businessProcessesRegistry } from './business-processes.registry';
import { chartOfAccountsRegistry } from './chart-of-accounts.registry';
import { companiesRegistry } from './companies.registry';
import { connectionsRegistry } from './connections.registry';
import { contactsRegistry } from './contacts.registry';
import { contractsRegistry, contractsRegistryFor } from './contracts.registry';
import { readDecisionWindowDays } from '../../../contracts/contract-settings.service';
import { departmentsRegistry } from './departments.registry';
import { documentsRegistry } from './documents.registry';
import { incidentsRegistry } from './incidents.registry';
import { interfacesRegistry } from './interfaces.registry';
import { locationsRegistry } from './locations.registry';
import { projectsRegistry } from './projects.registry';
import { requestsRegistry } from './requests.registry';
import { dataAccessRegistry } from './data-access.registry';
import { rolePermissionsRegistry } from './role-permissions.registry';
import { rolesRegistry } from './roles.registry';
import { suppliersRegistry } from './suppliers.registry';
import { supportDeadlinesRegistry } from './support-deadlines.registry';
import { supportGapsRegistry } from './support-gaps.registry';
import { tasksRegistry } from './tasks.registry';
import { technologiesRegistry } from './technologies.registry';
import { technologyVersionsRegistry } from './technology-versions.registry';
import { usersRegistry } from './users.registry';
import { vulnerabilitiesRegistry } from './vulnerabilities.registry';
import { chargebackRegistry } from './chargeback.registry';
import { chargebackLinesRegistry } from './chargeback-lines.registry';
import { costCentersRegistry } from './cost-centers.registry';
import { workingDayCalendarsRegistry } from './working-day-calendars.registry';
import { analyticsAxesRegistry } from './analytics-axes.registry';

export const aiEntityRegistries: Record<AiQueryEntityType, AiEntityFilterRegistry> = {
  accounts: accountsRegistry,
  analytics_categories: analyticsCategoriesRegistry,
  applications: applicationsRegistry,
  assets: assetsRegistry,
  budget_lines: budgetLinesRegistry,
  business_processes: businessProcessesRegistry,
  chart_of_accounts: chartOfAccountsRegistry,
  companies: companiesRegistry,
  connections: connectionsRegistry,
  contacts: contactsRegistry,
  contracts: contractsRegistry,
  data_access: dataAccessRegistry,
  departments: departmentsRegistry,
  documents: documentsRegistry,
  incidents: incidentsRegistry,
  interfaces: interfacesRegistry,
  locations: locationsRegistry,
  projects: projectsRegistry,
  requests: requestsRegistry,
  role_permissions: rolePermissionsRegistry,
  roles: rolesRegistry,
  suppliers: suppliersRegistry,
  support_deadlines: supportDeadlinesRegistry,
  support_gaps: supportGapsRegistry,
  tasks: tasksRegistry,
  technologies: technologiesRegistry,
  technology_versions: technologyVersionsRegistry,
  users: usersRegistry,
  vulnerabilities: vulnerabilitiesRegistry,
  chargeback: chargebackRegistry,
  chargeback_lines: chargebackLinesRegistry,
  cost_centers: costCentersRegistry,
  working_day_calendars: workingDayCalendarsRegistry,
  analytics_axes: analyticsAxesRegistry,
};

export function getAiEntityRegistry(entityType: AiQueryEntityType): AiEntityFilterRegistry {
  return aiEntityRegistries[entityType];
}

/** The field the default analytics dimension keeps on both item types; the other dimensions come right after it. */
const DEFAULT_ANALYTICS_FIELD = 'analytics_category';

/** `opex` or `capex` only: a line of the other nature is empty on the dimension. */
function axisNatureScope(axis: AnalyticsAxisInfo): 'opex' | 'capex' | null {
  if (axis.applies_to === 'opex' || axis.applies_to === 'capex') return axis.applies_to;
  return null;
}

function axisScopeSentence(axis: AnalyticsAxisInfo): string {
  const scope = axisNatureScope(axis);
  return scope
    ? ` It applies to ${scope.toUpperCase()} lines only: a line of the other nature is empty on it.`
    : ' It applies to both natures.';
}

/**
 * A copy of the budget lines registry with one field per enabled non-default
 * analytics dimension, `analytics:<code>`, reading the engine's
 * `analytics_<axis id>` value (set, dynamic, sortable, groupable). The default
 * dimension stays `analytics_category`, whatever its position, code or name.
 * Every dimension that applies to either nature is kept; a dimension that
 * applies to one nature only says so, and is empty on the other.
 */
export function withAnalyticsAxisFields(registry: AiEntityFilterRegistry, axes: AnalyticsAxisInfo[]): AiEntityFilterRegistry {
  const defaultAxis = axes.find((axis) => axis.is_default);
  const extra = axes
    .filter((axis) => !axis.is_default && isAxisActive(axis) && (axisAppliesTo(axis, 'opex') || axisAppliesTo(axis, 'capex')))
    .map((axis): [string, AiFilterFieldDef] => {
      const key = `${ANALYTICS_CSV_PREFIX}${axis.code}`;
      const name = axis.name?.trim() || axis.code;
      return [key, {
        ai: key,
        grid: analyticsFieldKey(axis.id),
        type: 'set',
        description: `Analytics dimension "${name}": the line's value on it.${axisScopeSentence(axis)} null is a line without a value on this dimension, or a line of the other nature.`,
        ...(axisNatureScope(axis) ? { nature: axisNatureScope(axis)! } : {}),
        dynamic: true,
        discoverable: true,
        sortable: true,
        groupable: true,
      }];
    });
  const renamedDefault = defaultAxis?.name?.trim();
  const defaultScope = defaultAxis ? axisNatureScope(defaultAxis) : null;
  if (!extra.length && !renamedDefault && !defaultScope) return registry;

  const fields: Record<string, AiFilterFieldDef> = {};
  for (const [key, field] of Object.entries(registry.fields)) {
    fields[key] = key === DEFAULT_ANALYTICS_FIELD && (renamedDefault || defaultScope)
      ? {
        ...field,
        description: `${field.description}${renamedDefault ? ` This tenant calls it "${renamedDefault}".` : ''}${defaultScope ? ` It applies to ${defaultScope.toUpperCase()} lines only: a line of the other nature is empty on it.` : ''}`,
        ...(defaultScope ? { nature: defaultScope } : {}),
      }
      : field;
    if (key === DEFAULT_ANALYTICS_FIELD) for (const [extraKey, extraField] of extra) fields[extraKey] = extraField;
  }
  const sortFields: Record<string, string> = {};
  for (const [key, grid] of Object.entries(registry.sortFields)) {
    sortFields[key] = grid;
    if (key === DEFAULT_ANALYTICS_FIELD) for (const [extraKey, extraField] of extra) sortFields[extraKey] = extraField.grid;
  }
  return { ...registry, fields, sortFields };
}

/** Whether the caller reads a family (`AiPolicyService.canReadEntityType`). */
export type AiReadProbe = (entityType: AiQueryEntityType) => Promise<boolean>;

/**
 * Fields that count or name another module's records, with that module: listed, filtered, sorted
 * and aggregated only for a caller who reads it, as on the record's page (the application
 * Relations tab, the task page).
 */
const LINKED_COUNT_FIELDS: Partial<Record<AiQueryEntityType, Record<string, AiQueryEntityType>>> = {
  applications: { budget_lines_count: 'budget_lines', contracts_count: 'contracts' },
  contracts: { application: 'applications' },
  tasks: { application: 'applications', asset: 'assets', project_name: 'projects' },
  incidents: { asset: 'assets', application: 'applications', technology: 'technologies', asset_count: 'assets' },
  documents: {
    linked_application: 'applications',
    linked_asset: 'assets',
    linked_project: 'projects',
    linked_request: 'requests',
    linked_task: 'tasks',
  },
};

/**
 * The administration fields of a family: listed, filtered, sorted and grouped only for an
 * administrator of it whose own access is not limited, the read of Admin › Data access
 * (`data_access`: users at admin level, access not limited). A reader of users sees what the users
 * list shows them: name, email and status; an administrator of users in limited access no more,
 * the screen closing the administration of users to them (`frontend/src/auth/dataAccess.ts`). One
 * rule for every administration field of a person, the quick search included
 * (`UsersService.listForAi`, `accessView`).
 */
const UNSCOPED_ADMIN_FIELDS: Partial<Record<AiQueryEntityType, string[]>> = {
  users: [
    'job_title', 'company', 'department', 'primary_role', 'locale', 'team',
    'contributor_profile', 'project_availability', 'areas_of_expertise', 'roles', 'data_access',
  ],
};

/**
 * Fields that read another module's data with that module's right, as their screen: absent
 * (lists, filters, sorts, groups, filter values) for a person without it, and named with the
 * reason in `withheldFields`. The consolidation account of a budget line is read with the right on
 * accounts, as the Consolidation accounts report: without it the list engine reads every line as
 * "unassigned", a figure the tools never give.
 */
const RIGHT_GATED_FIELDS: Partial<Record<AiQueryEntityType, Record<string, { family: AiQueryEntityType; reason: string }>>> = {
  budget_lines: {
    consolidation_account: {
      family: 'accounts',
      reason: 'The consolidation accounts are read with the right on accounts (Accounts, reader level), as the Consolidation accounts report, and this person does not have it. '
        + 'Tell them the consolidation accounts are not available to them, and do not report their lines as without a consolidation account.',
    },
  },
};

/** The registry without the linked counts, filters and groups of the modules the caller does not read. */
export async function withoutUnreadableLinkedCounts(
  registry: AiEntityFilterRegistry,
  canRead: AiReadProbe,
): Promise<AiEntityFilterRegistry> {
  const gated = LINKED_COUNT_FIELDS[registry.entityType];
  const unscopedAdminOnly = UNSCOPED_ADMIN_FIELDS[registry.entityType];
  const rightGated = RIGHT_GATED_FIELDS[registry.entityType];
  if (!gated && !unscopedAdminOnly && !rightGated) return registry;
  const hidden = new Set<string>();
  for (const [field, entityType] of Object.entries(gated ?? {})) {
    if (!(await canRead(entityType))) hidden.add(field);
  }
  if (unscopedAdminOnly && !(await canRead('data_access'))) {
    for (const field of unscopedAdminOnly) hidden.add(field);
  }
  const withheld: AiWithheldField[] = [];
  for (const [field, { family, reason }] of Object.entries(rightGated ?? {})) {
    if (!registry.fields[field] || (await canRead(family))) continue;
    hidden.add(field);
    withheld.push({ field, reason });
  }
  if (!hidden.size) return registry;
  const kept = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([key]) => !hidden.has(key)));
  return {
    ...registry,
    ...(withheld.length ? { withheldFields: [...(registry.withheldFields ?? []), ...withheld] } : {}),
    fields: kept(registry.fields),
    sortFields: kept(registry.sortFields),
    aggregate: {
      ...registry.aggregate,
      groupFields: kept(registry.aggregate.groupFields),
      ...(registry.aggregate.metricFields ? { metricFields: kept(registry.aggregate.metricFields) } : {}),
    },
  };
}

/**
 * The registry of one entity type for the tenant of the call: the budget lines
 * gain the fields of the analytics dimensions that apply to either nature (one
 * tenant-predicated query), contracts read the tenant's decision window (their `term_state`
 * group), every other type is the static registry. Resolved once per tool call and passed
 * down; `getAiEntityRegistry` stays for static callers. With `canRead` (every tool call), the
 * counts of the modules the caller does not read are left out (`withoutUnreadableLinkedCounts`).
 */
export async function resolveAiEntityRegistry(
  context: { manager: EntityManager; tenantId: string },
  entityType: AiQueryEntityType,
  canRead?: AiReadProbe,
): Promise<AiEntityFilterRegistry> {
  const registry = await tenantRegistry(context, entityType);
  return canRead ? withoutUnreadableLinkedCounts(registry, canRead) : registry;
}

async function tenantRegistry(
  context: { manager: EntityManager; tenantId: string },
  entityType: AiQueryEntityType,
): Promise<AiEntityFilterRegistry> {
  if (entityType === 'contracts') return contractsRegistryFor(await readDecisionWindowDays(context.manager, context.tenantId));
  const registry = getAiEntityRegistry(entityType);
  if (entityType !== 'budget_lines') return registry;
  const axes = await loadAnalyticsAxes(context.manager, context.tenantId);
  return withAnalyticsAxisFields(registry, axes);
}

/** The `analytics:<code>` fields of a resolved registry with the row key each reads. */
export function analyticsAxisFields(registry: AiEntityFilterRegistry): Array<{ key: string; grid: string; nature?: 'opex' | 'capex' }> {
  return Object.entries(registry.fields)
    .filter(([key]) => key.startsWith(ANALYTICS_CSV_PREFIX))
    .map(([key, field]) => ({ key, grid: field.grid, ...(field.nature ? { nature: field.nature } : {}) }));
}
