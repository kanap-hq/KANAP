import { EntityManager } from 'typeorm';
import {
  AnalyticsAxisInfo,
  ANALYTICS_CSV_PREFIX,
  analyticsFieldKey,
  axisAppliesTo,
  isAxisActive,
  loadAnalyticsAxes,
} from '../../../analytics/analytics-axes.util';
import { AiEntityFilterRegistry, AiFilterFieldDef, AiQueryEntityType } from '../ai-filter.types';
import { accountsRegistry } from './accounts.registry';
import { analyticsCategoriesRegistry } from './analytics-categories.registry';
import { applicationsRegistry } from './applications.registry';
import { assetsRegistry } from './assets.registry';
import { businessProcessesRegistry } from './business-processes.registry';
import { capexItemsRegistry } from './capex-items.registry';
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
import { spendItemsRegistry } from './spend-items.registry';
import { suppliersRegistry } from './suppliers.registry';
import { tasksRegistry } from './tasks.registry';
import { technologiesRegistry } from './technologies.registry';
import { usersRegistry } from './users.registry';
import { vulnerabilitiesRegistry } from './vulnerabilities.registry';

export const aiEntityRegistries: Record<AiQueryEntityType, AiEntityFilterRegistry> = {
  accounts: accountsRegistry,
  analytics_categories: analyticsCategoriesRegistry,
  applications: applicationsRegistry,
  assets: assetsRegistry,
  business_processes: businessProcessesRegistry,
  capex_items: capexItemsRegistry,
  chart_of_accounts: chartOfAccountsRegistry,
  companies: companiesRegistry,
  connections: connectionsRegistry,
  contacts: contactsRegistry,
  contracts: contractsRegistry,
  departments: departmentsRegistry,
  documents: documentsRegistry,
  incidents: incidentsRegistry,
  interfaces: interfacesRegistry,
  locations: locationsRegistry,
  projects: projectsRegistry,
  requests: requestsRegistry,
  spend_items: spendItemsRegistry,
  suppliers: suppliersRegistry,
  tasks: tasksRegistry,
  technologies: technologiesRegistry,
  users: usersRegistry,
  vulnerabilities: vulnerabilitiesRegistry,
};

export function getAiEntityRegistry(entityType: AiQueryEntityType): AiEntityFilterRegistry {
  return aiEntityRegistries[entityType];
}

/** The field the default analytics dimension keeps on both item types; the other dimensions come right after it. */
const DEFAULT_ANALYTICS_FIELD = 'analytics_category';

/**
 * A copy of an OPEX or CAPEX registry with one field per enabled non-default
 * analytics dimension, `analytics:<code>`, reading the engine's
 * `analytics_<axis id>` value (set, dynamic, sortable, groupable). The default
 * dimension stays `analytics_category`, whatever its position, code or name.
 */
export function withAnalyticsAxisFields(registry: AiEntityFilterRegistry, axes: AnalyticsAxisInfo[]): AiEntityFilterRegistry {
  const defaultAxis = axes.find((axis) => axis.is_default);
  const extra = axes
    .filter((axis) => !axis.is_default && isAxisActive(axis))
    .map((axis): [string, AiFilterFieldDef] => {
      const key = `${ANALYTICS_CSV_PREFIX}${axis.code}`;
      const name = axis.name?.trim() || axis.code;
      return [key, {
        ai: key,
        grid: analyticsFieldKey(axis.id),
        type: 'set',
        description: `Analytics dimension "${name}": the line's value on it. null is a line without a value on this dimension.`,
        dynamic: true,
        discoverable: true,
        sortable: true,
        groupable: true,
      }];
    });
  const renamedDefault = defaultAxis?.name?.trim();
  if (!extra.length && !renamedDefault) return registry;

  const fields: Record<string, AiFilterFieldDef> = {};
  for (const [key, field] of Object.entries(registry.fields)) {
    fields[key] = key === DEFAULT_ANALYTICS_FIELD && renamedDefault
      ? { ...field, description: `${field.description} This tenant calls it "${renamedDefault}".` }
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

/**
 * Whether the caller reads a family (`AiPolicyService.canReadEntityType`), or holds `level` on it
 * when given (`admin`: the users administration).
 */
export type AiReadProbe = (entityType: AiQueryEntityType, level?: 'reader' | 'admin') => Promise<boolean>;

/**
 * Fields that count or name another module's records, with that module: listed, filtered, sorted
 * and aggregated only for a caller who reads it, as on the record's page (the application
 * Relations tab, the task page).
 */
const LINKED_COUNT_FIELDS: Partial<Record<AiQueryEntityType, Record<string, AiQueryEntityType>>> = {
  applications: { spend_count: 'spend_items', capex_count: 'capex_items', contracts_count: 'contracts' },
  contracts: { application: 'applications' },
  tasks: { application: 'applications', asset: 'assets', project_name: 'projects' },
  incidents: { asset: 'assets', application: 'applications', asset_count: 'assets' },
  documents: {
    linked_application: 'applications',
    linked_asset: 'assets',
    linked_project: 'projects',
    linked_request: 'requests',
    linked_task: 'tasks',
  },
};

/**
 * The fields of a family that its own list shows only to an administrator of it. A reader of users
 * sees what the users list shows them: name, email and status.
 */
const ADMIN_ONLY_FIELDS: Partial<Record<AiQueryEntityType, string[]>> = {
  users: [
    'job_title', 'company', 'department', 'primary_role', 'locale', 'team',
    'contributor_profile', 'project_availability', 'areas_of_expertise',
  ],
};

/** The registry without the linked counts of the modules the caller does not read. */
export async function withoutUnreadableLinkedCounts(
  registry: AiEntityFilterRegistry,
  canRead: AiReadProbe,
): Promise<AiEntityFilterRegistry> {
  const gated = LINKED_COUNT_FIELDS[registry.entityType];
  const adminOnly = ADMIN_ONLY_FIELDS[registry.entityType];
  if (!gated && !adminOnly) return registry;
  const hidden = new Set<string>();
  for (const [field, entityType] of Object.entries(gated ?? {})) {
    if (!(await canRead(entityType))) hidden.add(field);
  }
  if (adminOnly && !(await canRead(registry.entityType, 'admin'))) {
    for (const field of adminOnly) hidden.add(field);
  }
  if (!hidden.size) return registry;
  const kept = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([key]) => !hidden.has(key)));
  return {
    ...registry,
    fields: kept(registry.fields),
    sortFields: kept(registry.sortFields),
    aggregate: {
      ...registry.aggregate,
      ...(registry.aggregate.metricFields ? { metricFields: kept(registry.aggregate.metricFields) } : {}),
    },
  };
}

/**
 * The registry of one entity type for the tenant of the call: OPEX and CAPEX
 * gain the fields of the analytics dimensions that apply to their lines (one
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
  if (entityType !== 'spend_items' && entityType !== 'capex_items') return registry;
  const scope = entityType === 'spend_items' ? 'opex' : 'capex';
  const axes = await loadAnalyticsAxes(context.manager, context.tenantId);
  return withAnalyticsAxisFields(registry, axes.filter((axis) => axisAppliesTo(axis, scope)));
}

/** The `analytics:<code>` fields of a resolved registry with the row key each reads. */
export function analyticsAxisFields(registry: AiEntityFilterRegistry): Array<{ key: string; grid: string }> {
  return Object.entries(registry.fields)
    .filter(([key]) => key.startsWith(ANALYTICS_CSV_PREFIX))
    .map(([key, field]) => ({ key, grid: field.grid }));
}
