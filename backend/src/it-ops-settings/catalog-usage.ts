import { EntityManager } from 'typeorm';

/**
 * Where each IT Ops catalog value is referenced on business records. Used by the usage endpoint and by
 * the PATCH guard, which share the same counts: one count per record type, deduplicated by the record
 * identifier (a connection cited by two columns or two legs counts once), always filtered by tenant.
 */

export type UsageRecordType = 'applications' | 'assets' | 'interfaces' | 'connections' | 'app_instances' | 'interface_bindings' | 'locations' | 'incidents' | 'server_assignments' | 'subnets' | 'technologies';

/** A predicate on `t` (the record table) or on a table joined to it; `$1` = tenant id, `$2` = the value. */
type UsagePredicate =
  | { kind: 'scalar'; table: string; column: string; recordId?: string }
  | { kind: 'array'; table: string; column: string; recordId?: string }
  | { kind: 'jsonb_type' }
  | { kind: 'jsonb_subnet' };

export type UsageSource = {
  record: UsageRecordType;
  /** Head table whose ids are counted. */
  table: string;
  predicates: UsagePredicate[];
  /** Filterable field on the list page, when a deep link exists. */
  listPath?: { page: string; field: string; extra?: string };
};

export type CatalogUsageItem = { record: UsageRecordType; count: number; listPath?: string };

const applications = (column: string, field = column): UsageSource => ({ record: 'applications', table: 'applications', predicates: [{ kind: 'scalar', table: 'applications', column }], listPath: { page: '/it/applications', field, extra: '&appScope=all' } });
const assets = (column: string, filterable = true): UsageSource => ({ record: 'assets', table: 'assets', predicates: [{ kind: 'scalar', table: 'assets', column }], ...(filterable ? { listPath: { page: '/it/assets', field: column } } : {}) });
const technologies = (column: string): UsageSource => ({ record: 'technologies', table: 'technologies', predicates: [{ kind: 'scalar', table: 'technologies', column }] });
const interfaces = (column: string): UsageSource => ({ record: 'interfaces', table: 'interfaces', predicates: [{ kind: 'scalar', table: 'interfaces', column }] });
const connections = (...columns: string[]): UsageSource => ({ record: 'connections', table: 'connections', predicates: columns.map((column) => ({ kind: 'scalar', table: 'connections', column })) });
const connectionLegs = (column: string, kind: 'scalar' | 'array' = 'scalar'): UsageSource => ({ record: 'connections', table: 'connections', predicates: [{ kind, table: 'connection_legs', column, recordId: 'connection_id' }] });
const interfaceLegs = (column: string): UsageSource => ({ record: 'interfaces', table: 'interfaces', predicates: [{ kind: 'scalar', table: 'interface_legs', column, recordId: 'interface_id' }] });

export const CATALOG_USAGE: Record<string, UsageSource[]> = {
  applicationCategories: [applications('category')],
  lifecycleStates: [applications('lifecycle'), assets('status'), technologies('lifecycle'), interfaces('lifecycle'), connections('lifecycle'), { record: 'app_instances', table: 'app_instances', predicates: [{ kind: 'scalar', table: 'app_instances', column: 'lifecycle' }] }, { record: 'interface_bindings', table: 'interface_bindings', predicates: [{ kind: 'scalar', table: 'interface_bindings', column: 'status' }] }],
  dataClasses: [applications('data_class'), interfaces('data_class'), connections('data_class')],
  businessCriticalityLevels: [applications('criticality'), interfaces('criticality'), connections('criticality')],
  cyberCriticalityLevels: [applications('cyber_criticality'), technologies('cyber_criticality')],
  recoveryWaves: [applications('recovery_wave'), technologies('recovery_wave')],
  accessMethods: [{ record: 'applications', table: 'applications', predicates: [{ kind: 'array', table: 'applications', column: 'access_methods' }] }],
  serverKinds: [assets('kind')],
  serverProviders: [assets('provider'), { record: 'locations', table: 'locations', predicates: [{ kind: 'scalar', table: 'locations', column: 'provider' }] }],
  hostingTypes: [{ record: 'locations', table: 'locations', predicates: [{ kind: 'scalar', table: 'locations', column: 'hosting_type' }] }],
  serverRoles: [{ record: 'server_assignments', table: 'app_asset_assignments', predicates: [{ kind: 'scalar', table: 'app_asset_assignments', column: 'role' }] }],
  entities: [{ record: 'connections', table: 'connections', predicates: [{ kind: 'scalar', table: 'connections', column: 'source_entity_code' }, { kind: 'scalar', table: 'connections', column: 'destination_entity_code' }, { kind: 'scalar', table: 'connection_legs', column: 'equipment_entity_code', recordId: 'connection_id' }] }],
  operatingSystems: [assets('operating_system')],
  domains: [assets('domain', false)],
  ipAddressTypes: [{ record: 'assets', table: 'assets', predicates: [{ kind: 'jsonb_type' }] }],
  subnets: [{ record: 'assets', table: 'assets', predicates: [{ kind: 'jsonb_subnet' }] }],
  connectionTypes: [{ record: 'connections', table: 'connections', predicates: [{ kind: 'scalar', table: 'connection_protocols', column: 'connection_type_code', recordId: 'connection_id' }, { kind: 'array', table: 'connection_legs', column: 'protocol_codes', recordId: 'connection_id' }] }],
  pathHopFunctions: [connectionLegs('function_code')],
  interfaceDataCategories: [interfaces('data_category')],
  interfaceTriggerTypes: [interfaceLegs('trigger_type')],
  interfacePatterns: [interfaceLegs('integration_pattern')],
  interfaceFormats: [interfaceLegs('data_format')],
  interfaceAuthModes: [{ record: 'interface_bindings', table: 'interface_bindings', predicates: [{ kind: 'scalar', table: 'interface_bindings', column: 'authentication_mode' }] }],
  incidentCategories: [{ record: 'incidents', table: 'incidents', predicates: [{ kind: 'scalar', table: 'incidents', column: 'category' }], listPath: { page: '/it/incidents', field: 'category' } }],
  networkSegments: [{ record: 'subnets', table: 'settings', predicates: [] }],
  technologyFamilies: [technologies('family')],
  adminZones: [technologies('admin_zone')],
  interfaceProtocols: [],
};

export type UsageKey = { code: string } | { location_id: string; cidr: string };

function predicateSql(predicate: UsagePredicate, head: string): string {
  switch (predicate.kind) {
    case 'scalar':
      return predicate.table === head
        ? `t.${predicate.column} = $2`
        : `EXISTS (SELECT 1 FROM ${predicate.table} r WHERE r.tenant_id = $1 AND r.${predicate.recordId} = t.id AND r.${predicate.column} = $2)`;
    case 'array':
      return predicate.table === head
        ? `$2 = ANY(t.${predicate.column})`
        : `EXISTS (SELECT 1 FROM ${predicate.table} r WHERE r.tenant_id = $1 AND r.${predicate.recordId} = t.id AND $2 = ANY(r.${predicate.column}))`;
    case 'jsonb_type':
      return `t.ip_addresses IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.ip_addresses) e WHERE e->>'type' = $2)`;
    case 'jsonb_subnet':
      return `t.location_id = $3 AND t.ip_addresses IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.ip_addresses) e WHERE e->>'subnet_cidr' = $2)`;
  }
}

export function usageSql(source: UsageSource): string {
  const where = source.predicates.map((predicate) => `(${predicateSql(predicate, source.table)})`).join(' OR ');
  return `SELECT COUNT(DISTINCT t.id)::int AS count FROM ${source.table} t WHERE t.tenant_id = $1 AND (${where})`;
}

export function usageListPath(source: UsageSource, code: string): string | undefined {
  if (!source.listPath) return undefined;
  const filters = encodeURIComponent(JSON.stringify({ [source.listPath.field]: { filterType: 'set', values: [code] } }));
  return `${source.listPath.page}?filters=${filters}${source.listPath.extra ?? ''}`;
}

/** Counts, per record type, the records of `tenantId` referencing one catalog value. */
export async function countCatalogUsage(manager: EntityManager, tenantId: string, list: string, key: UsageKey, settingsSubnets?: Array<{ network_zone?: string }>): Promise<CatalogUsageItem[]> {
  const sources = CATALOG_USAGE[list];
  if (!sources) return [];
  const items: CatalogUsageItem[] = [];
  for (const source of sources) {
    let count = 0;
    if (source.table === 'settings') {
      count = 'code' in key ? (settingsSubnets ?? []).filter((subnet) => subnet.network_zone === key.code).length : 0;
    } else if ('cidr' in key) {
      if (!source.predicates.some((predicate) => predicate.kind === 'jsonb_subnet')) continue;
      const rows = await manager.query(usageSql(source), [tenantId, key.cidr, key.location_id]);
      count = Number(rows[0]?.count ?? 0);
    } else {
      if (source.predicates.some((predicate) => predicate.kind === 'jsonb_subnet')) continue;
      const rows = await manager.query(usageSql(source), [tenantId, key.code]);
      count = Number(rows[0]?.count ?? 0);
    }
    if (count > 0) items.push({ record: source.record, count, listPath: 'code' in key ? usageListPath(source, key.code) : undefined });
  }
  return items;
}
