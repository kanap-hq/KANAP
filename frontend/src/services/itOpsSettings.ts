import api from '../api';

export type CatalogLocale = 'en' | 'fr' | 'de' | 'es';
/** Per-locale overrides of a value's name and description typed by the tenant; an absent field falls back. */
export type CatalogTranslations = Partial<Record<CatalogLocale, { label?: string; description?: string }>>;

export type ItOpsEnumOption = {
  code: string;
  label: string;
  deprecated?: boolean;
  category?: string;
  translations?: CatalogTranslations;
  // UI-only helper for stable row keys; ignored by backend
  localId?: string;
};

export type ClassificationLevel = ItOpsEnumOption & {
  description: string;
  rank: number;
};

export type BusinessCriticalityLevel = ClassificationLevel & {
  maxMtdMinutes: number | null;
};

export type RecoveryWave = Omit<ClassificationLevel, 'rank'> & {
  order: number;
};

/** Levels are listed from most to least severe; waves in restoration order. The server assigns ranks from that order. */
export type ApplicationClassificationCatalog = {
  businessCriticalityLevels: BusinessCriticalityLevel[];
  cyberCriticalityLevels: ClassificationLevel[];
  dataClasses: ClassificationLevel[];
  recoveryWaves: RecoveryWave[];
};

export type ConnectionTypeOption = ItOpsEnumOption & {
  typicalPorts?: string;
};

export type AssetKindOption = ItOpsEnumOption & {
  is_physical?: boolean;
};

export type GraphTier = 'top' | 'upper' | 'center' | 'lower' | 'bottom';

export type ServerRoleOption = ItOpsEnumOption & {
  graph_tier?: GraphTier;
};

export type EntityOption = ItOpsEnumOption & {
  graph_tier?: GraphTier;
};

/** A trust between two domains, seen from the domain that carries it (Active Directory wording). */
export type DomainTrustDirection = 'two_way' | 'outgoing' | 'incoming';
export type DomainTrust = { domain: string; direction: DomainTrustDirection };

export type DomainOption = {
  code: string;
  label: string;
  dns_suffix: string;
  deprecated?: boolean;
  system?: boolean;
  translations?: CatalogTranslations;
  forest?: string;
  trusts?: DomainTrust[];
  account_count?: number;
  machine_count?: number;
  // UI-only helper for stable row keys; ignored by backend
  localId?: string;
};

/** An administration zone: who administers it, at which privilege level, where its secrets are kept. */
export type AdminZoneOption = ItOpsEnumOption & {
  admin_group?: string;
  privilege_level?: string;
  secrets_location?: string;
  description?: string;
};

export type SubnetOption = {
  location_id: string;    // Mandatory, references locations table
  cidr: string;           // e.g., "192.168.1.0/24" (mandatory)
  vlan_number?: number;   // Optional VLAN ID (1-4094)
  network_zone: string;   // Mandatory, references networkSegments code
  description?: string;   // Optional one-line description
  deprecated?: boolean;
  // UI-only helper for stable row keys; ignored by backend
  localId?: string;
};

export type ItOpsSettings = {
  applicationCategories: ItOpsEnumOption[];
  dataClasses: ItOpsEnumOption[];
  networkSegments: ItOpsEnumOption[];
  entities: EntityOption[];
  serverKinds: AssetKindOption[];
  serverProviders: ItOpsEnumOption[];
  serverRoles: ServerRoleOption[];
  hostingTypes: ItOpsEnumOption[];
  lifecycleStates: ItOpsEnumOption[];
  interfaceProtocols: ItOpsEnumOption[];
  interfaceDataCategories: ItOpsEnumOption[];
  interfaceTriggerTypes: ItOpsEnumOption[];
  interfacePatterns: ItOpsEnumOption[];
  interfaceFormats: ItOpsEnumOption[];
  interfaceAuthModes: ItOpsEnumOption[];
  connectionTypes: ConnectionTypeOption[];
  subnets: SubnetOption[];
  domains: DomainOption[];
  ipAddressTypes: ItOpsEnumOption[];
  accessMethods: ItOpsEnumOption[];
  incidentCategories: ItOpsEnumOption[];
  technologyFamilies: ItOpsEnumOption[];
  adminZones: AdminZoneOption[];
  businessCriticalityLevels: BusinessCriticalityLevel[];
  cyberCriticalityLevels: ClassificationLevel[];
  recoveryWaves: RecoveryWave[];
  /** Server-managed rows the editors must not edit nor remove. */
  lockedCodes?: Record<string, string[]>;
  /** Default rows the server re-adds after removal: editable and retirable, never removable. */
  protectedCodes?: Record<string, string[]>;
};

export type ClassificationSettingsPatch = ApplicationClassificationCatalog;

export async function fetchItOpsSettings(): Promise<ItOpsSettings> {
  const res = await api.get('/it-ops/settings');
  return res.data as ItOpsSettings;
}

export async function updateItOpsSettings(payload: Partial<ItOpsSettings>): Promise<ItOpsSettings> {
  const res = await api.patch('/it-ops/settings', payload);
  return res.data as ItOpsSettings;
}

export async function fetchApplicationClassificationCatalog(): Promise<ApplicationClassificationCatalog> {
  const res = await api.get('/applications/classification-catalog');
  return res.data as ApplicationClassificationCatalog;
}

export type CatalogUsageRecord = 'applications' | 'assets' | 'interfaces' | 'connections' | 'app_instances' | 'interface_bindings' | 'locations' | 'incidents' | 'server_assignments' | 'subnets' | 'technologies';
export type CatalogUsage = { total: number; usage: Array<{ record: CatalogUsageRecord; count: number; listPath?: string }> };
export type CatalogUsageKey = { code: string } | { location_id: string; cidr: string };

/** Records referencing one catalog value; the same counts protect removal on save. */
export async function fetchCatalogUsage(list: string, key: CatalogUsageKey): Promise<CatalogUsage> {
  const res = await api.get('/it-ops/settings/usage', { params: { list, ...key } });
  return res.data as CatalogUsage;
}

export async function resetItOpsSettingsToDefaults(): Promise<ItOpsSettings> {
  const res = await api.post('/it-ops/settings/reset', {});
  return res.data as ItOpsSettings;
}
