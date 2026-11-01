import { AuditService } from '../audit/audit.service';
import { ClassificationCatalog, ClassificationLevel, CLASSIFICATION_CATALOG_KEYS, OBSOLETE_CATALOG_METADATA_KEYS, catalogFromMetadata, catalogToMetadata, validateClassificationCatalog } from './classification-catalog';
import { CatalogTranslations, normalizeTranslations, prepareCatalogListForWrite } from './catalog-codes';
import { CATALOG_USAGE, CatalogUsageItem, UsageKey, countCatalogUsage } from './catalog-usage';
import { BadRequestException, Injectable } from '@nestjs/common';
import { englishList, RecordInUseException } from '../common/record-in-use';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';
import { Location } from '../locations/location.entity';

export type ItOpsEnumOption = {
  code: string;
  label: string;
  deprecated?: boolean;
  category?: string;
  /** Per-locale name/description overrides typed by the tenant; absent = fallback. */
  translations?: CatalogTranslations;
};

/** Incident register categories served to tenants that never customised the list (also used by the CSV import). */
export const DEFAULT_INCIDENT_CATEGORIES: ItOpsEnumOption[] = [
  { code: 'infrastructure', label: 'Infrastructure' },
  { code: 'security', label: 'Security' },
  { code: 'application', label: 'Application' },
  { code: 'data', label: 'Data' },
  { code: 'supplier', label: 'Supplier' },
  { code: 'other', label: 'Other' },
];

/**
 * Technology families served to tenants that never customised the list (plan
 * planning/cartographie-technologies.md): what a technology is, read by the lists, the reports and
 * the gaps (a database server without a database technology).
 */
export const DEFAULT_TECHNOLOGY_FAMILIES: ItOpsEnumOption[] = [
  { code: 'operating_system', label: 'Operating system' },
  { code: 'database', label: 'Database' },
  { code: 'application_server', label: 'Application server' },
  { code: 'web_server', label: 'Web server' },
  { code: 'hypervisor', label: 'Hypervisor' },
  { code: 'container', label: 'Containers' },
  { code: 'directory', label: 'Directory and identity' },
  { code: 'messaging', label: 'Messaging' },
  { code: 'integration', label: 'Integration' },
  { code: 'backup', label: 'Backup' },
  { code: 'monitoring', label: 'Monitoring' },
  { code: 'runtime', label: 'Runtime and framework' },
  { code: 'storage', label: 'Storage' },
  { code: 'network', label: 'Network' },
  { code: 'network_security', label: 'Security' },
  { code: 'administration', label: 'Administration' },
  { code: 'other', label: 'Other' },
];

/**
 * Hosting types served to tenants that never customised the list. Each one is on premises or in the
 * cloud (`category`); the contract compliance register reads that category too.
 */
export const DEFAULT_HOSTING_TYPES: ItOpsEnumOption[] = [
  { code: 'on_prem', label: 'On-prem', category: 'on_prem' },
  { code: 'colocation', label: 'Colocation', category: 'on_prem' },
  { code: 'public_cloud', label: 'Public Cloud', category: 'cloud' },
  { code: 'private_cloud', label: 'Private Cloud', category: 'cloud' },
  { code: 'saas', label: 'SaaS', category: 'cloud' },
];

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
export const DOMAIN_TRUST_DIRECTIONS: DomainTrustDirection[] = ['two_way', 'outgoing', 'incoming'];
export type DomainTrust = { domain: string; direction: DomainTrustDirection };

export type DomainOption = {
  code: string;
  label: string;
  dns_suffix: string;
  deprecated?: boolean;
  system?: boolean;
  translations?: CatalogTranslations;
  /** Administration view (lot A1a): the forest, the trusts to other domains of the list, and typed counts. */
  forest?: string;
  trusts?: DomainTrust[];
  account_count?: number;
  machine_count?: number;
};

/**
 * An administration zone (the tiered administration model, a recognized practice): the directory
 * group or the team that administers it. Tenants that never customised the list receive three tiers.
 */
export type AdminZoneOption = ItOpsEnumOption & {
  admin_group?: string;
  description?: string;
};

/**
 * Administration zones served to tenants that never customised the list (the recognized model of
 * Active Directory administration in three tiers). A tenant may rename, retire or replace them; an empty
 * stored list stays empty.
 */
export const DEFAULT_ADMIN_ZONES: AdminZoneOption[] = [
  {
    code: 'tier_0',
    label: 'Tier 0 (core of trust)',
    description: 'Identity and trust infrastructure: directories such as Active Directory or Entra ID, PKI, identity administration tools, and the systems that host them.',
  },
  {
    code: 'tier_1',
    label: 'Tier 1 (servers and applications)',
    description: 'Business servers, applications, databases and middleware.',
  },
  {
    code: 'tier_2',
    label: 'Tier 2 (workstations)',
    description: 'User workstations and devices.',
  },
];

export type SubnetOption = {
  location_id: string;    // Mandatory, references locations table
  cidr: string;           // e.g., "192.168.1.0/24" (mandatory)
  vlan_number?: number;   // Optional VLAN ID (1-4094)
  network_zone: string;   // Mandatory, references networkSegments code
  description?: string;   // Optional one-line description
  deprecated?: boolean;
};

export type ItOpsSettings = ClassificationCatalog & {
  applicationCategories: ItOpsEnumOption[];
  dataClasses: ClassificationLevel[];
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
  pathHopFunctions: ItOpsEnumOption[];
  incidentCategories: ItOpsEnumOption[];
  technologyFamilies: ItOpsEnumOption[];
  adminZones: AdminZoneOption[];
  /** Server-managed rows the editor must not edit nor remove. */
  lockedCodes?: Record<string, string[]>;
  /** Default rows the server re-adds after removal: editable and retirable, never removable. */
  protectedCodes?: Record<string, string[]>;
};

type ItOpsMetadataShape = {
  application_categories?: ItOpsEnumOption[];
  data_classes?: ItOpsEnumOption[];
  network_segments?: ItOpsEnumOption[];
  entities?: EntityOption[];
  server_kinds?: ItOpsEnumOption[];
  server_providers?: ItOpsEnumOption[];
  server_roles?: ServerRoleOption[];
  hosting_types?: ItOpsEnumOption[];
  lifecycle_states?: ItOpsEnumOption[];
  interface_protocols?: ItOpsEnumOption[];
  interface_data_categories?: ItOpsEnumOption[];
  interface_trigger_types?: ItOpsEnumOption[];
  interface_patterns?: ItOpsEnumOption[];
  interface_formats?: ItOpsEnumOption[];
  interface_auth_modes?: ItOpsEnumOption[];
  connection_types?: ConnectionTypeOption[];
  subnets?: SubnetOption[];
  domains?: DomainOption[];
  ip_address_types?: ItOpsEnumOption[];
  access_methods?: ItOpsEnumOption[];
  path_hop_functions?: ItOpsEnumOption[];
  incident_categories?: ItOpsEnumOption[];
  technology_families?: ItOpsEnumOption[];
  admin_zones?: AdminZoneOption[];
};

/**
 * Active catalog entries as `code (label)`, the list a refusal names (`allowed`).
 * A retired entry is left out: the screen no longer offers it to a new record.
 */
export function formatApplicationCategoryOptions(options: Array<{ code: string; label?: string | null; deprecated?: boolean }>): string {
  return options
    .filter((option) => !option.deprecated)
    .map((option) => {
      const label = String(option.label || '').trim();
      return label && label !== option.code ? `${option.code} (${label})` : option.code;
    })
    .join(', ');
}

@Injectable()
export class ItOpsSettingsService {
  private readonly lockedLifecycleStates: ItOpsEnumOption[] = [
    { code: 'proposed', label: 'Proposed' },
    { code: 'active', label: 'Active' },
    { code: 'deprecated', label: 'Deprecated' },
    { code: 'retired', label: 'Retired' },
  ];

  private readonly lockedLifecycleCodes = new Set(this.lockedLifecycleStates.map((item) => item.code));

  private readonly defaultLifecycleStates: ItOpsEnumOption[] = [...this.lockedLifecycleStates];

  private readonly defaultApplicationCategories: ItOpsEnumOption[] = [
    { code: 'line_of_business', label: 'Line-of-business' },
    { code: 'productivity', label: 'Productivity' },
    { code: 'security', label: 'Security' },
    { code: 'analytics', label: 'Analytics' },
    { code: 'development', label: 'Development' },
    { code: 'integration', label: 'Integration' },
    { code: 'infrastructure', label: 'Infrastructure' },
  ];

  private readonly defaultDataClasses: ItOpsEnumOption[] = [
    { code: 'public', label: 'Public' },
    { code: 'internal', label: 'Internal' },
    { code: 'confidential', label: 'Confidential' },
    { code: 'restricted', label: 'Restricted' },
  ];

  private readonly defaultNetworkSegments: ItOpsEnumOption[] = [
    { code: 'lan', label: 'LAN' },
    { code: 'dmz', label: 'DMZ' },
    { code: 'industrial_lan', label: 'Industrial LAN' },
    { code: 'wifi', label: 'WiFi' },
    { code: 'public_cloud', label: 'Public Cloud' },
    { code: 'guest', label: 'Guest' },
    { code: 'management', label: 'Management' },
    { code: 'storage', label: 'Storage' },
    { code: 'vpn', label: 'VPN' },
  ];

  private readonly defaultEntities: EntityOption[] = [
    { code: 'internal_users', label: 'Internal Users', graph_tier: 'top' },
    { code: 'external_users', label: 'External Users', graph_tier: 'top' },
    { code: 'internet', label: 'Internet', graph_tier: 'top' },
    { code: 'customers', label: 'Customers', graph_tier: 'top' },
    { code: 'partner_networks', label: 'Partner Networks', graph_tier: 'top' },
  ];

  private readonly defaultServerKinds: AssetKindOption[] = [
    // Existing types
    { code: 'physical_server', label: 'Physical Server', is_physical: true },
    { code: 'virtual_machine', label: 'Virtual Machine', is_physical: false },
    { code: 'container', label: 'Container', is_physical: false },
    { code: 'serverless', label: 'Serverless', is_physical: false },
    { code: 'appliance', label: 'Appliance', is_physical: true },
    { code: 'saas', label: 'SaaS', is_physical: false },
    { code: 'other', label: 'Other', is_physical: false },
    // New asset types
    { code: 'switch', label: 'Switch', is_physical: true },
    { code: 'firewall', label: 'Firewall', is_physical: true },
    { code: 'load_balancer', label: 'Load Balancer', is_physical: true },
    { code: 'access_point', label: 'Access Point', is_physical: true },
    { code: 'san', label: 'SAN', is_physical: true },
    { code: 'nas', label: 'NAS', is_physical: true },
    { code: 'backup_appliance', label: 'Backup Appliance', is_physical: true },
    { code: 'tape_library', label: 'Tape Library', is_physical: true },
    { code: 'industrial_robot', label: 'Industrial Robot', is_physical: true },
    { code: 'industrial_machine', label: 'Industrial Machine', is_physical: true },
    { code: 'rack', label: 'Rack', is_physical: true },
  ];

  private readonly defaultServerProviders: ItOpsEnumOption[] = [
    { code: 'aws', label: 'AWS' },
    { code: 'azure', label: 'Azure' },
    { code: 'gcp', label: 'GCP' },
    { code: 'other', label: 'Other' },
  ];

  private readonly defaultServerRoles: ServerRoleOption[] = [
    { code: 'app', label: 'Application server', graph_tier: 'upper' },
    { code: 'backup', label: 'Backup server', graph_tier: 'lower' },
    { code: 'cloud-service', label: 'Cloud service', graph_tier: 'upper' },
    { code: 'db', label: 'Database server', graph_tier: 'bottom' },
    { code: 'domain-controller', label: 'Domain controller', graph_tier: 'lower' },
    { code: 'file', label: 'File server', graph_tier: 'center' },
    { code: 'mail', label: 'Mail / messaging', graph_tier: 'center' },
    { code: 'monitoring', label: 'Monitoring server', graph_tier: 'center' },
    { code: 'other', label: 'Other', graph_tier: 'center' },
    { code: 'print', label: 'Print server', graph_tier: 'center' },
    { code: 'proxy', label: 'Proxy / gateway', graph_tier: 'top' },
    { code: 'remote-desktop', label: 'Remote desktop', graph_tier: 'center' },
    { code: 'virtualization', label: 'Virtualization host', graph_tier: 'lower' },
    { code: 'web', label: 'Web server', graph_tier: 'top' },
  ];

  private readonly defaultHostingTypes: ItOpsEnumOption[] = DEFAULT_HOSTING_TYPES;

  private readonly defaultInterfaceProtocols: ItOpsEnumOption[] = [
    { code: 'http', label: 'HTTP' },
    { code: 'https', label: 'HTTPS' },
    { code: 'ftp', label: 'FTP' },
    { code: 'sftp', label: 'SFTP' },
    { code: 'smb', label: 'SMB / Windows share' },
    { code: 'smtp', label: 'SMTP' },
    { code: 'jdbc', label: 'JDBC' },
    { code: 'odbc', label: 'ODBC' },
    { code: 'amqp', label: 'AMQP / MQ' },
    { code: 'ssh', label: 'SSH' },
    { code: 'other', label: 'Other' },
  ];

  private readonly defaultInterfaceDataCategories: ItOpsEnumOption[] = [
    { code: 'master_data', label: 'Master Data' },
    { code: 'transactional', label: 'Transactional' },
    { code: 'reporting', label: 'Reporting' },
    { code: 'control', label: 'Control' },
  ];

  private readonly defaultInterfaceTriggerTypes: ItOpsEnumOption[] = [
    { code: 'event_based', label: 'Event-based' },
    { code: 'scheduled', label: 'Scheduled' },
    { code: 'on_demand', label: 'On-demand' },
    { code: 'real_time', label: 'Real-time' },
  ];

  private readonly defaultInterfacePatterns: ItOpsEnumOption[] = [
    { code: 'rest_api_sync', label: 'REST API (sync)' },
    { code: 'rest_api_async', label: 'REST API (async / callback)' },
    { code: 'soap_webservice', label: 'SOAP web service' },
    { code: 'file_transfer_batch', label: 'File transfer (batch)' },
    { code: 'message_queue', label: 'Message queue (point-to-point)' },
    { code: 'pub_sub_topic', label: 'Pub/Sub (topic)' },
    { code: 'etl_batch', label: 'ETL batch job' },
    { code: 'db_link_view', label: 'DB link / direct DB read' },
    { code: 'scheduled_job', label: 'Scheduled script / job' },
    { code: 'webhook', label: 'Webhook' },
    { code: 'manual_import_export', label: 'Manual import / export' },
    { code: 'other', label: 'Other' },
  ];

  private readonly defaultInterfaceFormats: ItOpsEnumOption[] = [
    { code: 'csv', label: 'CSV' },
    { code: 'delimited', label: 'Delimited text' },
    { code: 'fixed_width', label: 'Fixed-width text' },
    { code: 'xml', label: 'XML' },
    { code: 'json', label: 'JSON' },
    { code: 'txt_plain', label: 'Plain text' },
    { code: 'xlsx', label: 'Excel (XLSX)' },
    { code: 'pdf', label: 'PDF' },
    { code: 'sap_idoc', label: 'SAP IDoc' },
    { code: 'edi_edifact', label: 'EDI EDIFACT' },
    { code: 'binary_custom', label: 'Binary (custom)' },
    { code: 'other', label: 'Other' },
  ];

  private readonly defaultInterfaceAuthModes: ItOpsEnumOption[] = [
    { code: 'service_account', label: 'Service account' },
    { code: 'oauth2', label: 'OAuth2' },
    { code: 'api_key', label: 'API key' },
    { code: 'certificate', label: 'Certificate' },
    { code: 'none', label: 'None' },
  ];

  private readonly defaultConnectionTypes: ConnectionTypeOption[] = [
    { category: 'Application', label: 'HTTP', code: 'http', typicalPorts: '80' },
    { category: 'Application', label: 'HTTPS', code: 'https', typicalPorts: '443' },
    { category: 'Application', label: 'WebSocket', code: 'ws', typicalPorts: '80, 443' },
    { category: 'Application', label: 'REST API', code: 'rest', typicalPorts: '80, 443' },
    { category: 'Application', label: 'SOAP', code: 'soap', typicalPorts: '80, 443' },
    { category: 'Database', label: 'SQL Server (TDS)', code: 'mssql', typicalPorts: '1433' },
    { category: 'Database', label: 'Oracle Net', code: 'oracle', typicalPorts: '1521' },
    { category: 'Database', label: 'MySQL', code: 'mysql', typicalPorts: '3306' },
    { category: 'Database', label: 'PostgreSQL', code: 'pgsql', typicalPorts: '5432' },
    { category: 'Database', label: 'MongoDB', code: 'mongodb', typicalPorts: '27017' },
    { category: 'Database', label: 'Redis', code: 'redis', typicalPorts: '6379' },
    { category: 'Authentication', label: 'LDAP', code: 'ldap', typicalPorts: '389' },
    { category: 'Authentication', label: 'LDAPS', code: 'ldaps', typicalPorts: '636' },
    { category: 'Authentication', label: 'Kerberos', code: 'kerberos', typicalPorts: '88' },
    { category: 'Authentication', label: 'RADIUS', code: 'radius', typicalPorts: '1812, 1813' },
    { category: 'Authentication', label: 'TACACS+', code: 'tacacs', typicalPorts: '49' },
    { category: 'Remote Access', label: 'SSH', code: 'ssh', typicalPorts: '22' },
    { category: 'Remote Access', label: 'RDP', code: 'rdp', typicalPorts: '3389' },
    { category: 'Remote Access', label: 'VNC', code: 'vnc', typicalPorts: '5900+' },
    { category: 'Remote Access', label: 'WinRM', code: 'winrm', typicalPorts: '5985, 5986' },
    { category: 'Remote Access', label: 'Telnet', code: 'telnet', typicalPorts: '23' },
    { category: 'File Transfer', label: 'SFTP', code: 'sftp', typicalPorts: '22' },
    { category: 'File Transfer', label: 'SCP', code: 'scp', typicalPorts: '22' },
    { category: 'File Transfer', label: 'FTP', code: 'ftp', typicalPorts: '21' },
    { category: 'File Transfer', label: 'FTPS', code: 'ftps', typicalPorts: '990' },
    { category: 'File Transfer', label: 'TFTP', code: 'tftp', typicalPorts: '69' },
    { category: 'File Sharing', label: 'SMB / CIFS', code: 'smb', typicalPorts: '445' },
    { category: 'File Sharing', label: 'NFS', code: 'nfs', typicalPorts: '2049' },
    { category: 'File Sharing', label: 'DFS', code: 'dfs', typicalPorts: '445' },
    { category: 'Storage', label: 'iSCSI', code: 'iscsi', typicalPorts: '3260' },
    { category: 'Storage', label: 'NDMP', code: 'ndmp', typicalPorts: '10000' },
    { category: 'Messaging', label: 'AMQP', code: 'amqp', typicalPorts: '5672' },
    { category: 'Messaging', label: 'MQTT', code: 'mqtt', typicalPorts: '1883, 8883' },
    { category: 'Messaging', label: 'Kafka', code: 'kafka', typicalPorts: '9092' },
    { category: 'Messaging', label: 'RabbitMQ', code: 'rabbitmq', typicalPorts: '5672' },
    { category: 'Email', label: 'SMTP', code: 'smtp', typicalPorts: '25, 587' },
    { category: 'Email', label: 'IMAP', code: 'imap', typicalPorts: '143, 993' },
    { category: 'Email', label: 'POP3', code: 'pop3', typicalPorts: '110, 995' },
    { category: 'Monitoring', label: 'SNMP', code: 'snmp', typicalPorts: '161, 162' },
    { category: 'Monitoring', label: 'Syslog', code: 'syslog', typicalPorts: '514' },
    { category: 'Monitoring', label: 'WMI', code: 'wmi', typicalPorts: '135 + dynamic' },
    { category: 'Monitoring', label: 'IPMI', code: 'ipmi', typicalPorts: '623' },
    { category: 'Monitoring', label: 'Zabbix Agent', code: 'zabbix', typicalPorts: '10050' },
    { category: 'Monitoring', label: 'Prometheus', code: 'prometheus', typicalPorts: '9090+' },
    { category: 'Network Services', label: 'DNS', code: 'dns', typicalPorts: '53' },
    { category: 'Network Services', label: 'NTP', code: 'ntp', typicalPorts: '123' },
    { category: 'Network Services', label: 'DHCP', code: 'dhcp', typicalPorts: '67, 68' },
    { category: 'Network Services', label: 'ICMP', code: 'icmp' },
    { category: 'Replication', label: 'AD Replication', code: 'ad-repl', typicalPorts: 'multiple' },
    { category: 'Replication', label: 'DFS-R', code: 'dfsr', typicalPorts: '5722' },
    { category: 'Replication', label: 'SQL AlwaysOn', code: 'sql-ag', typicalPorts: '5022' },
    { category: 'Replication', label: 'rsync', code: 'rsync', typicalPorts: '873' },
    { category: 'Replication', label: 'DRBD', code: 'drbd', typicalPorts: '7788' },
    { category: 'VPN / Tunnel', label: 'IPSec', code: 'ipsec', typicalPorts: '500, 4500' },
    { category: 'VPN / Tunnel', label: 'OpenVPN', code: 'openvpn', typicalPorts: '1194' },
    { category: 'VPN / Tunnel', label: 'WireGuard', code: 'wireguard', typicalPorts: '51820' },
    { category: 'VPN / Tunnel', label: 'SSL VPN', code: 'sslvpn', typicalPorts: '443' },
    { category: 'VPN / Tunnel', label: 'GRE', code: 'gre' },
    { category: 'Backup', label: 'Veeam', code: 'veeam', typicalPorts: 'multiple' },
    { category: 'Backup', label: 'Commvault', code: 'commvault', typicalPorts: '8400+' },
    { category: 'Backup', label: 'Bacula', code: 'bacula', typicalPorts: '9101-9103' },
    { category: 'Generic', label: 'TCP (custom)', code: 'tcp', typicalPorts: 'specify' },
    { category: 'Generic', label: 'UDP (custom)', code: 'udp', typicalPorts: 'specify' },
    { category: 'Generic', label: 'Other', code: 'other', typicalPorts: 'specify' },
    { category: 'Generic', label: 'Unknown', code: 'unknown' },
  ];

  private readonly defaultSubnets: SubnetOption[] = [];

  private readonly defaultIpAddressTypes: ItOpsEnumOption[] = [
    { code: 'host', label: 'Host' },
    { code: 'ipmi', label: 'IPMI' },
    { code: 'management', label: 'Management' },
    { code: 'iscsi', label: 'iSCSI' },
  ];

  private readonly defaultAccessMethods: ItOpsEnumOption[] = [
    { code: 'web', label: 'Web' },
    { code: 'local', label: 'Locally installed application' },
    { code: 'mobile', label: 'Mobile application' },
    { code: 'hmi', label: 'Proprietary HMI (industrial interface)' },
    { code: 'terminal', label: 'Terminal / CLI' },
    { code: 'vdi', label: 'VDI / Remote Desktop' },
    { code: 'kiosk', label: 'Kiosk' },
  ];

  /**
   * Default network-path hop functions (intermediaries documenting how a flow
   * is routed between source and destination). Tenants can edit this list.
   */
  private readonly defaultPathHopFunctions: ItOpsEnumOption[] = [
    { code: 'nat', label: 'NAT' },
    { code: 'vip', label: 'Virtual IP' },
    { code: 'firewall', label: 'Firewall' },
    { code: 'reverse_proxy', label: 'Reverse proxy' },
    { code: 'waf', label: 'WAF' },
    { code: 'load_balancer', label: 'Load balancer' },
    { code: 'ids_ips', label: 'IDS / IPS' },
    { code: 'api_gateway', label: 'API gateway' },
    { code: 'vpn_endpoint', label: 'VPN endpoint' },
    { code: 'bastion', label: 'Bastion / jump host' },
    { code: 'cdn_edge', label: 'CDN edge' },
    { code: 'service_mesh', label: 'Service mesh proxy' },
  ];

  private readonly defaultIncidentCategories: ItOpsEnumOption[] = DEFAULT_INCIDENT_CATEGORIES;
  private readonly defaultTechnologyFamilies: ItOpsEnumOption[] = DEFAULT_TECHNOLOGY_FAMILIES;
  private readonly defaultAdminZones: AdminZoneOption[] = DEFAULT_ADMIN_ZONES;

  private readonly lockedDomainCodes = new Set(['workgroup', 'n-a']);

  private readonly defaultDomains: DomainOption[] = [
    { code: 'workgroup', label: 'Workgroup', dns_suffix: '', system: true },
    { code: 'n-a', label: 'N/A', dns_suffix: '', system: true },
  ];

  constructor(
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    @InjectRepository(Location)
    private readonly locations: Repository<Location>,
    private readonly audit: AuditService,
  ) {}

  private repo(manager?: EntityManager) {
    return manager ? manager.getRepository(Tenant) : this.tenants;
  }

  private locationRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(Location) : this.locations;
  }

  private async getValidLocationIds(tenantId: string, manager?: EntityManager): Promise<Set<string>> {
    const repo = this.locationRepo(manager);
    const rows = await repo.find({
      where: { tenant_id: tenantId } as any,
      select: ['id'],
    });
    return new Set(rows.map((r) => r.id));
  }

  private normalizeCode(value: unknown): string {
    const code = String(value || '').trim().toLowerCase();
    if (!code) {
      throw new BadRequestException('code is required');
    }
    return code;
  }

  private normalizeLabel(value: unknown, fallbackCode: string): string {
    const label = String(value || '').trim();
    if (label) return label;
    return fallbackCode.toUpperCase();
  }

  private normalizeLookupKey(value: unknown): string {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ');
  }

  private effectiveApplicationCategories(settings: ItOpsSettings): ItOpsEnumOption[] {
    return settings.applicationCategories.length > 0
      ? settings.applicationCategories
      : this.defaultApplicationCategories;
  }

  private normalizeList(
    list: unknown,
    defaults: ItOpsEnumOption[],
  ): ItOpsEnumOption[] {
    const byCode = new Map<string, ItOpsEnumOption>();

    // If no tenant-specific list is provided, fall back to defaults
    const source: any[] | undefined = Array.isArray(list) ? (list as any[]) : defaults;

    for (const raw of source || []) {
      const code = this.normalizeCode(raw?.code ?? raw?.value);
      const label = this.normalizeLabel(raw?.label, code);
      const deprecated = !!raw?.deprecated;
      const category =
        raw?.category === 'on_prem' ? 'on_prem' : raw?.category === 'cloud' ? 'cloud' : undefined;
      const translations = normalizeTranslations(raw?.translations);
      byCode.set(code, {
        code,
        label,
        deprecated,
        ...(category ? { category } : {}),
        ...(translations ? { translations } : {}),
      });
    }

    return Array.from(byCode.values());
  }

  private normalizeTieredList<T extends ItOpsEnumOption & { graph_tier?: GraphTier }>(
    list: unknown,
    defaults: T[],
  ): T[] {
    const validTiers = new Set<GraphTier>(['top', 'upper', 'center', 'lower', 'bottom']);
    const defaultTierByCode = new Map<string, GraphTier>(
      defaults.map((d) => [d.code, d.graph_tier || 'center']),
    );
    const byCode = new Map<string, T>();

    // If no tenant-specific list is provided, fall back to defaults
    const source: any[] | undefined = Array.isArray(list) ? (list as any[]) : defaults;

    for (const raw of source || []) {
      const code = this.normalizeCode(raw?.code ?? raw?.value);
      const label = this.normalizeLabel(raw?.label, code);
      const deprecated = !!raw?.deprecated;
      const rawTier = String(raw?.graph_tier ?? '')
        .trim()
        .toLowerCase() as GraphTier;
      const graph_tier = validTiers.has(rawTier)
        ? rawTier
        : defaultTierByCode.get(code) || 'center';

      const translations = normalizeTranslations(raw?.translations);
      byCode.set(code, {
        code,
        label,
        deprecated,
        graph_tier,
        ...(translations ? { translations } : {}),
      } as T);
    }

    return Array.from(byCode.values());
  }

  private normalizeNetworkZones(
    list: unknown,
    defaults: ItOpsEnumOption[],
  ): ItOpsEnumOption[] {
    const byCode = new Map<string, ItOpsEnumOption>();

    // Process tenant's existing list if provided
    if (Array.isArray(list)) {
      for (const raw of list) {
        const code = this.normalizeCode(raw?.code ?? raw?.value);
        const label = this.normalizeLabel(raw?.label, code);
        const deprecated = !!raw?.deprecated;
        const translations = normalizeTranslations(raw?.translations);
        byCode.set(code, { code, label, deprecated, ...(translations ? { translations } : {}) });
      }
    }

    // Ensure all default zones are present (add any missing defaults at the end)
    for (const def of defaults) {
      if (!byCode.has(def.code)) {
        byCode.set(def.code, { ...def });
      }
    }

    return Array.from(byCode.values());
  }

  private normalizeConnectionTypes(
    list: unknown,
    defaults: ConnectionTypeOption[],
  ): ConnectionTypeOption[] {
    const byCode = new Map<string, ConnectionTypeOption>();
    const source: any[] | undefined = Array.isArray(list) ? (list as any[]) : defaults;

    for (const raw of source || []) {
      const code = this.normalizeCode(raw?.code ?? raw?.value);
      const label = this.normalizeLabel(raw?.label ?? raw?.name, code);
      const deprecated = !!raw?.deprecated;
      const category = String(raw?.category ?? '').trim();
      const rawPorts = raw?.typicalPorts ?? raw?.typical_ports ?? raw?.ports ?? raw?.port;
      const typicalPorts =
        rawPorts === undefined || rawPorts === null || String(rawPorts).trim() === ''
          ? undefined
          : String(rawPorts).trim();
      const translations = normalizeTranslations(raw?.translations);
      byCode.set(code, {
        code,
        label,
        deprecated,
        ...(category ? { category } : {}),
        ...(typicalPorts ? { typicalPorts } : {}),
        ...(translations ? { translations } : {}),
      });
    }

    return Array.from(byCode.values());
  }

  private normalizeAssetKinds(
    list: unknown,
    defaults: AssetKindOption[],
  ): AssetKindOption[] {
    const byCode = new Map<string, AssetKindOption>();
    const defaultsMap = new Map(defaults.map((d) => [d.code, d]));

    // Process tenant's existing list if provided
    if (Array.isArray(list)) {
      for (const raw of list) {
        const code = this.normalizeCode(raw?.code ?? raw?.value);
        const label = this.normalizeLabel(raw?.label, code);
        const deprecated = !!raw?.deprecated;
        // Preserve is_physical from input, or fall back to default for known codes, or false
        let is_physical: boolean;
        if (raw?.is_physical !== undefined) {
          is_physical = !!raw.is_physical;
        } else {
          const def = defaultsMap.get(code);
          is_physical = def?.is_physical ?? false;
        }
        const translations = normalizeTranslations(raw?.translations);
        byCode.set(code, {
          code,
          label,
          deprecated,
          is_physical,
          ...(translations ? { translations } : {}),
        });
      }
    }

    // Ensure all default types are present (add any missing defaults at the end)
    for (const def of defaults) {
      if (!byCode.has(def.code)) {
        byCode.set(def.code, { ...def });
      }
    }

    return Array.from(byCode.values());
  }

  private normalizeCidr(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    if (!text) return null;

    // Basic CIDR validation pattern: IPv4 address followed by /prefix
    const cidrPattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;
    const match = text.match(cidrPattern);
    if (!match) {
      throw new BadRequestException(`Invalid CIDR format "${value}"`);
    }

    // Validate octet values (0-255)
    const octets = [
      parseInt(match[1], 10),
      parseInt(match[2], 10),
      parseInt(match[3], 10),
      parseInt(match[4], 10),
    ];
    for (const octet of octets) {
      if (octet < 0 || octet > 255) {
        throw new BadRequestException(`Invalid CIDR "${value}": octet value must be 0-255`);
      }
    }

    // Validate prefix length (0-32 for IPv4)
    const prefix = parseInt(match[5], 10);
    if (prefix < 0 || prefix > 32) {
      throw new BadRequestException(`Invalid CIDR "${value}": prefix length must be 0-32`);
    }

    return text;
  }

  private normalizeSubnets(
    list: unknown,
    defaults: SubnetOption[],
    networkZoneCodes: Set<string>,
    validLocationIds: Set<string>,
    opts?: { strict?: boolean },
  ): SubnetOption[] {
    const strict = opts?.strict ?? false;
    // Key: location_id:cidr for uniqueness within a location
    const byLocationCidr = new Map<string, SubnetOption>();
    // Key: location_id:vlan_number for VLAN uniqueness within a location
    const vlanByLocation = new Map<string, string>(); // location:vlan -> cidr

    // Get first valid location for legacy subnets without location_id
    const firstLocationId = validLocationIds.size > 0 ? Array.from(validLocationIds)[0] : null;

    // Process tenant's existing list if provided
    if (Array.isArray(list)) {
      for (const raw of list) {
        let location_id = String(raw?.location_id ?? '').trim();

        // Handle legacy subnets without location_id
        if (!location_id) {
          if (strict) {
            throw new BadRequestException('location_id is required for each subnet');
          }
          // Auto-assign to first location when reading legacy data
          if (firstLocationId) {
            location_id = firstLocationId;
          } else {
            continue; // Skip if no locations exist
          }
        }

        if (!validLocationIds.has(location_id)) {
          if (strict) {
            throw new BadRequestException(`Invalid location_id "${location_id}" for subnet`);
          }
          continue; // Skip subnets with invalid location_id when reading
        }

        const cidr = this.normalizeCidr(raw?.cidr);
        if (!cidr) continue;

        const network_zone = String(raw?.network_zone ?? '').trim().toLowerCase();
        if (!network_zone || !networkZoneCodes.has(network_zone)) {
          if (strict) {
            throw new BadRequestException(`Invalid network_zone "${raw?.network_zone}" for subnet ${cidr}`);
          }
          continue; // Skip subnets with invalid network_zone when reading
        }

        const vlan_number =
          raw?.vlan_number !== undefined && raw?.vlan_number !== null && String(raw.vlan_number).trim() !== ''
            ? parseInt(String(raw.vlan_number), 10)
            : undefined;
        if (vlan_number !== undefined && (isNaN(vlan_number) || vlan_number < 1 || vlan_number > 4094)) {
          if (strict) {
            throw new BadRequestException(`Invalid vlan_number for subnet ${cidr}. Must be between 1 and 4094.`);
          }
          continue; // Skip subnets with invalid vlan_number when reading
        }

        // Check for duplicate VLAN numbers within the same location
        if (vlan_number !== undefined) {
          const vlanKey = `${location_id}:${vlan_number}`;
          const existingCidr = vlanByLocation.get(vlanKey);
          if (existingCidr && existingCidr !== cidr) {
            if (strict) {
              throw new BadRequestException(
                `Duplicate VLAN number ${vlan_number} at this location: already assigned to subnet ${existingCidr}`,
              );
            }
            continue; // Skip duplicate VLANs when reading
          }
          vlanByLocation.set(vlanKey, cidr);
        }

        const description = String(raw?.description ?? '').trim() || undefined;
        const deprecated = !!raw?.deprecated;

        // Composite key: location_id:cidr (same CIDR can exist at different locations)
        const compositeKey = `${location_id}:${cidr}`;
        byLocationCidr.set(compositeKey, { location_id, cidr, vlan_number, network_zone, description, deprecated });
      }
    }

    // Ensure all default subnets are present (add any missing defaults at the end)
    for (const def of defaults) {
      const compositeKey = `${def.location_id}:${def.cidr}`;
      if (!byLocationCidr.has(compositeKey)) {
        byLocationCidr.set(compositeKey, { ...def });
      }
    }

    return Array.from(byLocationCidr.values());
  }

  private normalizeDomains(
    list: unknown,
    defaults: DomainOption[],
    opts?: { strict?: boolean },
  ): DomainOption[] {
    const strict = opts?.strict ?? false;
    const byCode = new Map<string, DomainOption>();
    const rawTrusts = new Map<string, unknown>();

    // Ensure locked system entries are always present first
    for (const def of defaults.filter((d) => d.system)) {
      byCode.set(def.code, { ...def });
    }

    // Process tenant's existing list if provided
    if (Array.isArray(list)) {
      for (const raw of list) {
        const code = this.normalizeCode(raw?.code ?? raw?.value);
        // Skip if trying to override system entries
        if (this.lockedDomainCodes.has(code)) continue;

        const label = this.normalizeLabel(raw?.label, code);
        const dns_suffix = String(raw?.dns_suffix ?? label ?? '').trim().toLowerCase();
        const deprecated = !!raw?.deprecated;
        const translations = normalizeTranslations(raw?.translations);
        const forest = this.optionalText(raw?.forest, 'Forest', 200, strict);
        const account_count = this.optionalCount(raw?.account_count, 'Number of accounts', strict);
        const machine_count = this.optionalCount(raw?.machine_count, 'Number of machines', strict);
        byCode.set(code, {
          code, label, dns_suffix, deprecated, system: false,
          ...(translations ? { translations } : {}),
          ...(forest ? { forest } : {}),
          ...(account_count !== undefined ? { account_count } : {}),
          ...(machine_count !== undefined ? { machine_count } : {}),
        });
        if (raw?.trusts !== undefined && raw?.trusts !== null) rawTrusts.set(code, raw.trusts);
      }
    }

    // Add non-system defaults that weren't overridden
    for (const def of defaults.filter((d) => !d.system)) {
      if (!byCode.has(def.code)) {
        byCode.set(def.code, { ...def });
      }
    }

    // Trusts name other domains of the list: a trust to a domain no longer listed, a system entry or
    // itself is dropped; one trust per domain pair (the first one wins).
    for (const [code, trusts] of rawTrusts) {
      if (!Array.isArray(trusts)) {
        if (strict) throw new BadRequestException('Domains: trusts must be a list');
        continue;
      }
      const kept = new Map<string, DomainTrust>();
      for (const trust of trusts) {
        const domain = String((trust as any)?.domain ?? '').trim().toLowerCase();
        const rawDirection = String((trust as any)?.direction ?? '').trim().toLowerCase();
        const direction = (DOMAIN_TRUST_DIRECTIONS as string[]).includes(rawDirection) ? rawDirection as DomainTrustDirection : null;
        if (!direction && strict) throw new BadRequestException(`Domains: "${rawDirection}" is not a trust direction (two_way, outgoing or incoming)`);
        if (!domain || domain === code || this.lockedDomainCodes.has(domain) || !byCode.has(domain) || kept.has(domain)) continue;
        kept.set(domain, { domain, direction: direction ?? 'two_way' });
      }
      if (kept.size) byCode.get(code)!.trusts = [...kept.values()];
    }

    return Array.from(byCode.values());
  }

  /** A short text, trimmed; empty is absent. Too long: refused on a write, cut on a read. */
  private optionalText(value: unknown, field: string, max: number, strict: boolean): string | undefined {
    const text = String(value ?? '').trim();
    if (!text) return undefined;
    if (text.length > max) {
      if (strict) throw new BadRequestException(`${field} is too long (${max} characters maximum)`);
      return text.slice(0, max);
    }
    return text;
  }

  /**
   * A typed count (accounts, machines): a whole number from 0 to 100,000,000, given as a number or
   * its text; empty is absent. Anything else (a boolean, a list, a fraction): refused on a write,
   * dropped on a read.
   */
  private optionalCount(value: unknown, field: string, strict: boolean): number | undefined {
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return undefined;
    const n = typeof value === 'number' ? value : typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : NaN;
    if (Number.isInteger(n) && n >= 0 && n <= 100_000_000) return n;
    if (strict) throw new BadRequestException(`${field} must be a whole number from 0 to 100,000,000`);
    return undefined;
  }

  private normalizeAdminZones(list: unknown, defaults: AdminZoneOption[], opts?: { strict?: boolean }): AdminZoneOption[] {
    const strict = opts?.strict ?? false;
    const byCode = new Map<string, AdminZoneOption>();
    const source: any[] | undefined = Array.isArray(list) ? list : defaults;
    for (const raw of source || []) {
      const code = this.normalizeCode(raw?.code ?? raw?.value);
      const label = this.normalizeLabel(raw?.label, code);
      const translations = normalizeTranslations(raw?.translations);
      const admin_group = this.optionalText(raw?.admin_group, 'Administrator group', 200, strict);
      const description = this.optionalText(raw?.description, 'Description', 2000, strict);
      byCode.set(code, {
        code, label, deprecated: !!raw?.deprecated,
        ...(admin_group ? { admin_group } : {}),
        ...(description ? { description } : {}),
        ...(translations ? { translations } : {}),
      });
    }
    return Array.from(byCode.values());
  }

  private async getMetadataSettings(
    tenant: Tenant,
    opts?: { manager?: EntityManager },
  ): Promise<ItOpsSettings> {
    const raw = (tenant.metadata?.it_ops as ItOpsMetadataShape | undefined) ?? {};
    const applicationCategories = this.normalizeList(raw.application_categories, this.defaultApplicationCategories);
    const catalog = catalogFromMetadata(raw);
    const dataClasses = catalog.dataClasses;
    const networkSegments = this.normalizeNetworkZones(raw.network_segments, this.defaultNetworkSegments);
    const entities = this.normalizeTieredList(raw.entities, this.defaultEntities);
    const serverKinds = this.normalizeAssetKinds(raw.server_kinds, this.defaultServerKinds);
    const serverProviders = this.normalizeList(raw.server_providers, this.defaultServerProviders);
    const serverRoles = this.normalizeTieredList(raw.server_roles, this.defaultServerRoles);
    const hostingTypes = this.normalizeHostingTypes(raw.hosting_types, this.defaultHostingTypes);
    const lifecycleStates = this.normalizeLifecycleStates(raw.lifecycle_states, this.defaultLifecycleStates);
    const interfaceProtocols = this.normalizeList(raw.interface_protocols, this.defaultInterfaceProtocols);
    const interfaceDataCategories = this.normalizeList(
      (raw as any).interface_data_categories,
      this.defaultInterfaceDataCategories,
    );
    const interfaceTriggerTypes = this.normalizeList(
      (raw as any).interface_trigger_types,
      this.defaultInterfaceTriggerTypes,
    );
    const interfacePatterns = this.normalizeList(
      (raw as any).interface_patterns,
      this.defaultInterfacePatterns,
    );
    const interfaceFormats = this.normalizeList(
      (raw as any).interface_formats,
      this.defaultInterfaceFormats,
    );
    const interfaceAuthModes = this.normalizeList(
      (raw as any).interface_auth_modes,
      this.defaultInterfaceAuthModes,
    );
    const connectionTypes = this.normalizeConnectionTypes(
      (raw as any).connection_types,
      this.defaultConnectionTypes,
    );
    // Subnets need networkSegments codes and valid location IDs for validation
    const networkZoneCodes = new Set(networkSegments.map((n) => n.code));
    const validLocationIds = await this.getValidLocationIds(tenant.id, opts?.manager);
    const subnets = this.normalizeSubnets(
      (raw as any).subnets,
      this.defaultSubnets,
      networkZoneCodes,
      validLocationIds,
    );
    const domains = this.normalizeDomains(raw.domains, this.defaultDomains);
    const ipAddressTypes = this.normalizeList(raw.ip_address_types, this.defaultIpAddressTypes);
    const accessMethods = this.normalizeList(raw.access_methods, this.defaultAccessMethods);
    const pathHopFunctions = this.normalizeList(
      (raw as any).path_hop_functions,
      this.defaultPathHopFunctions,
    );
    const incidentCategories = this.normalizeList(raw.incident_categories, this.defaultIncidentCategories);
    const technologyFamilies = this.normalizeList(raw.technology_families, this.defaultTechnologyFamilies);
    const adminZones = this.normalizeAdminZones(raw.admin_zones, this.defaultAdminZones);
    return {
      lockedCodes: { lifecycleStates: [...this.lockedLifecycleCodes], domains: [...this.lockedDomainCodes] },
      protectedCodes: { networkSegments: this.defaultNetworkSegments.map((item) => item.code), serverKinds: this.defaultServerKinds.map((item) => item.code) },
      ...catalog,
      applicationCategories,
      dataClasses,
      networkSegments,
      entities,
      serverKinds,
      serverProviders,
      serverRoles,
      hostingTypes,
      lifecycleStates,
      interfaceProtocols,
      interfaceDataCategories,
      interfaceTriggerTypes,
      interfacePatterns,
      interfaceFormats,
      interfaceAuthModes,
      connectionTypes,
      subnets,
      domains,
      ipAddressTypes,
      accessMethods,
      pathHopFunctions,
      incidentCategories,
      technologyFamilies,
      adminZones,
    };
  }

  /**
   * Settings read by a write path that will store catalog codes. Takes a shared lock on the tenant row so
   * the read serializes with a concurrent settings PATCH (which locks it FOR UPDATE): a value counted as
   * unused cannot be referenced by a write that validated against the older catalog.
   */
  async getSettingsForWrite(tenantId: string, manager?: EntityManager): Promise<ItOpsSettings> {
    if (manager) await manager.query('SELECT id FROM tenants WHERE id = $1 FOR SHARE', [tenantId]);
    return this.getSettings(tenantId, { manager });
  }

  async getSettings(
    tenantId: string,
    opts?: { manager?: EntityManager },
  ): Promise<ItOpsSettings> {
    const repo = this.repo(opts?.manager);
    const tenant = await repo.findOne({ where: { id: tenantId } });
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`);
    }
    return this.getMetadataSettings(tenant, { manager: opts?.manager });
  }

  async getApplicationCategoryOptions(
    tenantId: string,
    opts?: { manager?: EntityManager },
  ): Promise<ItOpsEnumOption[]> {
    return this.effectiveApplicationCategories(await this.getSettings(tenantId, opts));
  }

  async getDefaultApplicationCategoryCode(
    tenantId: string,
    opts?: { manager?: EntityManager },
  ): Promise<string> {
    const options = await this.getApplicationCategoryOptions(tenantId, opts);
    const defaultCode = this.defaultApplicationCategories[0]?.code;
    if (defaultCode && options.some((option) => option.code === defaultCode)) {
      return defaultCode;
    }
    const fallbackCode = options[0]?.code ?? defaultCode;
    if (!fallbackCode) {
      throw new BadRequestException('No application categories are configured');
    }
    return fallbackCode;
  }

  async resolveApplicationCategoryOption(
    tenantId: string,
    value: unknown,
    opts?: { manager?: EntityManager; useDefaultForEmpty?: boolean },
  ): Promise<ItOpsEnumOption> {
    const options = await this.getApplicationCategoryOptions(tenantId, { manager: opts?.manager });
    const text = String(value ?? '').trim();
    if (!text) {
      if (opts?.useDefaultForEmpty) {
        const fallbackCode = await this.getDefaultApplicationCategoryCode(tenantId, { manager: opts?.manager });
        const fallback = options.find((option) => option.code === fallbackCode);
        if (fallback) return fallback;
      }
      throw new BadRequestException('Application category is required');
    }

    const codeKey = this.normalizeLookupKey(text);
    const byCode = options.find((option) => this.normalizeLookupKey(option.code) === codeKey);
    if (byCode) return byCode;

    const byLabel = options.find((option) => this.normalizeLookupKey(option.label) === codeKey);
    if (byLabel) return byLabel;

    throw new BadRequestException(
      `Invalid application category "${text}". Valid application categories for this tenant: ${formatApplicationCategoryOptions(options)}.`,
    );
  }

  async resolveApplicationCategoryCode(
    tenantId: string,
    value: unknown,
    opts?: { manager?: EntityManager; useDefaultForEmpty?: boolean },
  ): Promise<string> {
    return (await this.resolveApplicationCategoryOption(tenantId, value, opts)).code;
  }

  private async updateSettingsLocked(
    tenantId: string,
    patch: Partial<ItOpsSettings>,
    opts?: { manager?: EntityManager; userId?: string | null },
  ): Promise<ItOpsSettings> {
    const repo = this.repo(opts?.manager);
    const tenant = await repo.findOne({ where: { id: tenantId } });
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`);
    }

    const current = await this.getMetadataSettings(tenant, { manager: opts?.manager });
    const next: ItOpsSettings = { ...current };
    patch = this.prepareCatalogPatch(patch);

    if (patch.applicationCategories) {
      next.applicationCategories = this.normalizeList(
        patch.applicationCategories,
        this.defaultApplicationCategories,
      );
    }
    if (patch.networkSegments) {
      next.networkSegments = this.normalizeNetworkZones(
        patch.networkSegments,
        this.defaultNetworkSegments,
      );
    }
    if (patch.entities) {
      next.entities = this.normalizeTieredList(
        patch.entities,
        this.defaultEntities,
      );
    }
    if (patch.serverKinds) {
      next.serverKinds = this.normalizeAssetKinds(
        patch.serverKinds,
        this.defaultServerKinds,
      );
    }
    if (patch.serverProviders) {
      next.serverProviders = this.normalizeList(
        patch.serverProviders,
        this.defaultServerProviders,
      );
    }
    if (patch.serverRoles) {
      next.serverRoles = this.normalizeTieredList(
        patch.serverRoles,
        this.defaultServerRoles,
      );
    }
    if (patch.hostingTypes) {
      next.hostingTypes = this.normalizeHostingTypes(
        patch.hostingTypes,
        this.defaultHostingTypes,
      );
    }
    if (patch.lifecycleStates) {
      next.lifecycleStates = this.normalizeLifecycleStates(
        patch.lifecycleStates,
        this.defaultLifecycleStates,
      );
    }
    if (patch.interfaceProtocols) {
      next.interfaceProtocols = this.normalizeList(patch.interfaceProtocols, this.defaultInterfaceProtocols);
    }
    if (patch.interfaceDataCategories) {
      next.interfaceDataCategories = this.normalizeList(
        patch.interfaceDataCategories,
        this.defaultInterfaceDataCategories,
      );
    }
    if (patch.interfaceTriggerTypes) {
      next.interfaceTriggerTypes = this.normalizeList(
        patch.interfaceTriggerTypes,
        this.defaultInterfaceTriggerTypes,
      );
    }
    if (patch.interfacePatterns) {
      next.interfacePatterns = this.normalizeList(
        patch.interfacePatterns,
        this.defaultInterfacePatterns,
      );
    }
    if (patch.interfaceFormats) {
      next.interfaceFormats = this.normalizeList(
        patch.interfaceFormats,
        this.defaultInterfaceFormats,
      );
    }
    if (patch.interfaceAuthModes) {
      next.interfaceAuthModes = this.normalizeList(
        patch.interfaceAuthModes,
        this.defaultInterfaceAuthModes,
      );
    }
    if (patch.connectionTypes) {
      next.connectionTypes = this.normalizeConnectionTypes(
        patch.connectionTypes,
        this.defaultConnectionTypes,
      );
    }
    if (patch.subnets) {
      const networkZoneCodes = new Set(next.networkSegments.map((n) => n.code));
      const validLocationIds = await this.getValidLocationIds(tenantId, opts?.manager);
      next.subnets = this.normalizeSubnets(
        patch.subnets,
        this.defaultSubnets,
        networkZoneCodes,
        validLocationIds,
        { strict: true },
      );
    }
    if (patch.domains) {
      next.domains = this.normalizeDomains(patch.domains, this.defaultDomains, { strict: true });
    }
    if (patch.ipAddressTypes) {
      next.ipAddressTypes = this.normalizeList(patch.ipAddressTypes, this.defaultIpAddressTypes);
    }
    if (patch.accessMethods) {
      next.accessMethods = this.normalizeList(patch.accessMethods, this.defaultAccessMethods);
    }
    if (patch.pathHopFunctions) {
      next.pathHopFunctions = this.normalizeList(patch.pathHopFunctions, this.defaultPathHopFunctions);
    }
    if (patch.incidentCategories) {
      next.incidentCategories = this.normalizeList(patch.incidentCategories, this.defaultIncidentCategories);
    }
    if (patch.technologyFamilies) {
      next.technologyFamilies = this.normalizeList(patch.technologyFamilies, this.defaultTechnologyFamilies);
    }
    if (patch.adminZones) {
      next.adminZones = this.normalizeAdminZones(patch.adminZones, this.defaultAdminZones, { strict: true });
    }

    const catalogChanged = CLASSIFICATION_CATALOG_KEYS.some((key) => patch[key] !== undefined);
    if (catalogChanged) {
      // Saving the catalog never moves an application: levels are referenced by stable code.
      Object.assign(next, this.prepareClassificationCatalog(current, patch));
    }
    await this.assertCatalogUsage(tenantId, current, next, patch, opts!.manager!);
    const meta: any = tenant.metadata || {};
    const itOps: any = {
      ...(meta.it_ops || {}),
      ...catalogToMetadata(next),
      application_categories: next.applicationCategories,
      data_classes: next.dataClasses,
      network_segments: next.networkSegments,
      entities: next.entities,
      server_kinds: next.serverKinds,
      server_providers: next.serverProviders,
      server_roles: next.serverRoles,
      hosting_types: next.hostingTypes,
      lifecycle_states: next.lifecycleStates,
      interface_protocols: next.interfaceProtocols,
      interface_data_categories: next.interfaceDataCategories,
      interface_trigger_types: next.interfaceTriggerTypes,
      interface_patterns: next.interfacePatterns,
      interface_formats: next.interfaceFormats,
      interface_auth_modes: next.interfaceAuthModes,
      connection_types: next.connectionTypes,
      subnets: next.subnets,
      domains: next.domains,
      ip_address_types: next.ipAddressTypes,
      access_methods: next.accessMethods,
      path_hop_functions: next.pathHopFunctions,
      incident_categories: next.incidentCategories,
      technology_families: next.technologyFamilies,
      admin_zones: next.adminZones,
    };
    for (const key of OBSOLETE_CATALOG_METADATA_KEYS) delete itOps[key];
    // The spread above keeps a key the migration already removed. A later save must not put it back.
    delete itOps.operating_systems;
    meta.it_ops = itOps;
    tenant.metadata = meta;

    await repo.save(tenant);
    await this.audit.log({ table: 'tenants', recordId: tenantId, action: 'update', before: current, after: next, userId: opts?.userId }, opts);
    return next;
  }

  async getClassificationCatalog(tenantId: string, opts?: { manager?: EntityManager }): Promise<ClassificationCatalog> {
    const tenant = await this.repo(opts?.manager).findOne({ where: { id: tenantId } });
    if (!tenant) throw new BadRequestException('Tenant not found');
    return catalogFromMetadata(tenant.metadata?.it_ops as any);
  }

  async lockClassificationCatalog(tenantId: string, manager: EntityManager): Promise<ClassificationCatalog> {
    await manager.query('SELECT id FROM tenants WHERE id = $1 FOR UPDATE', [tenantId]);
    return this.getClassificationCatalog(tenantId, { manager });
  }

  async updateSettings(tenantId: string, patch: Partial<ItOpsSettings>, opts?: { manager?: EntityManager; userId?: string | null }): Promise<ItOpsSettings> {
    const manager = opts?.manager ?? this.tenants.manager;
    return manager.transaction(async (tx) => {
      await tx.query('SELECT id FROM tenants WHERE id = $1 FOR UPDATE', [tenantId]);
      return this.updateSettingsLocked(tenantId, patch, { ...opts, manager: tx });
    });
  }

  private prepareClassificationCatalog(current: ClassificationCatalog, patch: Partial<ClassificationCatalog>): ClassificationCatalog {
    const merged = { ...current };
    for (const key of CLASSIFICATION_CATALOG_KEYS) if (patch[key] !== undefined) (merged as any)[key] = patch[key];
    return validateClassificationCatalog(merged);
  }

  /** Human names and write rules per list; the order of rows is preserved by every normalizer. */
  static readonly LIST_META: Record<string, { name: string; commaSeparatedInCsv?: boolean; subnets?: boolean }> = {
    applicationCategories: { name: 'Application categories' }, networkSegments: { name: 'Network zones' }, entities: { name: 'Entities' },
    serverKinds: { name: 'Asset types' }, serverProviders: { name: 'Cloud providers' }, serverRoles: { name: 'Server roles' },
    hostingTypes: { name: 'Hosting types' }, lifecycleStates: { name: 'Lifecycle statuses' }, interfaceProtocols: { name: 'Interface protocols' },
    interfaceDataCategories: { name: 'Interface data categories' }, interfaceTriggerTypes: { name: 'Interface trigger types' },
    interfacePatterns: { name: 'Integration patterns' }, interfaceFormats: { name: 'Interface data formats' }, interfaceAuthModes: { name: 'Interface authentication modes' },
    connectionTypes: { name: 'Connection types' }, subnets: { name: 'Subnets', subnets: true }, domains: { name: 'Domains' },
    ipAddressTypes: { name: 'IP address types' }, accessMethods: { name: 'Access methods', commaSeparatedInCsv: true }, pathHopFunctions: { name: 'Path hop functions' },
    incidentCategories: { name: 'Incident categories' }, businessCriticalityLevels: { name: 'Business criticality' }, cyberCriticalityLevels: { name: 'Cyber criticality' },
    dataClasses: { name: 'Data confidentiality' }, recoveryWaves: { name: 'Recovery waves' }, technologyFamilies: { name: 'Technology families' },
    adminZones: { name: 'Administration zones' },
  };

  /** Write-time rules for the lists a PATCH carries: codes generated from names, aliases unique. Reads stay tolerant. */
  private prepareCatalogPatch(patch: Partial<ItOpsSettings>): Partial<ItOpsSettings> {
    const prepared: Record<string, unknown> = { ...patch };
    for (const [key, meta] of Object.entries(ItOpsSettingsService.LIST_META)) {
      const rows = (patch as Record<string, unknown>)[key];
      if (rows === undefined || meta.subnets) continue;
      const skipCodes = key === 'lifecycleStates' ? this.lockedLifecycleCodes : key === 'domains' ? this.lockedDomainCodes : undefined;
      prepared[key] = prepareCatalogListForWrite(rows, { listName: meta.name, commaSeparatedInCsv: meta.commaSeparatedInCsv, skipCodes });
    }
    return prepared as Partial<ItOpsSettings>;
  }

  /** Usage of one catalog value on business records, shared by the usage endpoint and the PATCH guard. */
  async getCatalogUsage(tenantId: string, list: string, key: UsageKey, opts?: { manager?: EntityManager }): Promise<{ total: number; usage: CatalogUsageItem[] }> {
    if (!(list in CATALOG_USAGE)) throw new BadRequestException(`Unknown catalog "${list}"`);
    const manager = opts?.manager ?? this.tenants.manager;
    const settings = list === 'networkSegments' ? await this.getSettings(tenantId, { manager }) : undefined;
    const usage = await countCatalogUsage(manager, tenantId, list, key, settings?.subnets);
    return { total: usage.reduce((sum, item) => sum + item.count, 0), usage };
  }

  /**
   * A value removed from a list must not be referenced any more; "no longer offered" is the alternative.
   * The settings page checks each removal first (`settings/usage`); this guard answers a save that
   * removes a value used meanwhile, or sent by another client.
   */
  private async assertCatalogUsage(tenantId: string, current: ItOpsSettings, next: ItOpsSettings, patch: Partial<ItOpsSettings>, manager: EntityManager): Promise<void> {
    for (const [key, meta] of Object.entries(ItOpsSettingsService.LIST_META)) {
      if ((patch as Record<string, unknown>)[key] === undefined || !(key in CATALOG_USAGE)) continue;
      const before = ((current as any)[key] ?? []) as Array<Record<string, any>>;
      const after = ((next as any)[key] ?? []) as Array<Record<string, any>>;
      const identity = (row: Record<string, any>) => meta.subnets ? `${row.location_id}:${row.cidr}` : String(row.code);
      const kept = new Set(after.map(identity));
      for (const row of before) {
        if (kept.has(identity(row))) continue;
        const usageKey: UsageKey = meta.subnets ? { location_id: row.location_id, cidr: row.cidr } : { code: row.code };
        const { total, usage } = await this.getCatalogUsage(tenantId, key, usageKey, { manager: manager });
        if (!total) continue;
        const label = meta.subnets ? row.cidr : row.label || row.code;
        throw new CatalogValueInUseException(key, row.code ?? null, String(label), usage);
      }
    }
  }

  async resetToDefaults(tenantId: string, opts?: { manager?: EntityManager; userId?: string | null }): Promise<ItOpsSettings> {
    const manager = opts?.manager ?? this.tenants.manager;
    const defaults = await this.getMetadataSettings({ id: tenantId, metadata: {} } as Tenant, { manager });
    return this.updateSettings(tenantId, defaults, opts);
  }

  private normalizeHostingTypes(list: unknown, defaults: ItOpsEnumOption[]): ItOpsEnumOption[] {
    const normalized = this.normalizeList(list, defaults);
    return normalized.map((item) => {
      let category: 'on_prem' | 'cloud' | undefined =
        item.category === 'on_prem' ? 'on_prem' : item.category === 'cloud' ? 'cloud' : undefined;
      if (!category) {
        category = item.code === 'on_prem' || item.code === 'colocation' ? 'on_prem' : 'cloud';
      }
      return { ...item, category };
    });
  }

  private normalizeLifecycleStates(list: unknown, defaults: ItOpsEnumOption[]): ItOpsEnumOption[] {
    const normalized = this.normalizeList(list, defaults);
    const extras = normalized.filter((item) => !this.lockedLifecycleCodes.has(item.code));
    return [...this.lockedLifecycleStates, ...extras];
  }
}

/**
 * A settings save refused because it removes a list value that records still use: a 409 like a
 * refused delete (the save conflicts with the records, its content is valid), translated through
 * `errors:CATALOG_VALUE_IN_USE` with the value and the counts per kind. `list`, `value_code`,
 * `label` and `usage` (with the links to the records) stay for API callers.
 */
export class CatalogValueInUseException extends RecordInUseException {
  constructor(list: string, valueCode: string | null, label: string, usage: CatalogUsageItem[]) {
    const usages = usage.map((item) => ({ type: item.record, total: item.count }));
    super(
      'CATALOG_VALUE_IN_USE',
      'value',
      label,
      usages,
      `"${label}" is still used by ${englishList(usages)}. Mark it as no longer offered instead of removing it.`,
      { value: label },
    );
    const body = this.getResponse() as Record<string, unknown>;
    Object.assign(body, { list, value_code: valueCode, label, usage });
  }
}
