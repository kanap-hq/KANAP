import i18n from 'i18next';
import type { CatalogDefaults, DefaultCopy } from './catalogLocalization';

/**
 * The IT Ops catalog values every tenant starts with, by list and code, with the English label the
 * backend ships (`default*` lists in backend/src/it-ops-settings/it-ops-settings.service.ts). A value
 * that keeps its code and this label is shown in the user's language (`it:catalogDefaults.<list>.<code>`);
 * a renamed or added value shows its own label. Values that read the same in every language (product
 * and protocol names such as "Windows Server 2022" or "HTTPS") are left out. The lifecycle states and
 * the classification levels have their own tables.
 */
const SHIPPED_LABELS: Record<string, Record<string, string>> = {
  applicationCategories: {
    line_of_business: 'Line-of-business',
    productivity: 'Productivity',
    security: 'Security',
    analytics: 'Analytics',
    development: 'Development',
    integration: 'Integration',
    infrastructure: 'Infrastructure',
  },
  networkSegments: {
    industrial_lan: 'Industrial LAN',
    wifi: 'WiFi',
    public_cloud: 'Public Cloud',
    guest: 'Guest',
    management: 'Management',
    storage: 'Storage',
  },
  entities: {
    internal_users: 'Internal Users',
    external_users: 'External Users',
    internet: 'Internet',
    customers: 'Customers',
    partner_networks: 'Partner Networks',
  },
  serverKinds: {
    physical_server: 'Physical Server',
    virtual_machine: 'Virtual Machine',
    container: 'Container',
    serverless: 'Serverless',
    appliance: 'Appliance',
    saas: 'SaaS',
    other: 'Other',
    switch: 'Switch',
    firewall: 'Firewall',
    load_balancer: 'Load Balancer',
    access_point: 'Access Point',
    san: 'SAN',
    nas: 'NAS',
    backup_appliance: 'Backup Appliance',
    tape_library: 'Tape Library',
    industrial_robot: 'Industrial Robot',
    industrial_machine: 'Industrial Machine',
    rack: 'Rack',
  },
  serverProviders: {
    other: 'Other',
  },
  serverRoles: {
    app: 'Application server',
    backup: 'Backup server',
    'cloud-service': 'Cloud service',
    db: 'Database server',
    'domain-controller': 'Domain controller',
    file: 'File server',
    mail: 'Mail / messaging',
    monitoring: 'Monitoring server',
    other: 'Other',
    print: 'Print server',
    proxy: 'Proxy / gateway',
    'remote-desktop': 'Remote desktop',
    virtualization: 'Virtualization host',
    web: 'Web server',
  },
  hostingTypes: {
    on_prem: 'On-prem',
    colocation: 'Colocation',
    public_cloud: 'Public Cloud',
    private_cloud: 'Private Cloud',
  },
  interfaceProtocols: {
    smb: 'SMB / Windows share',
    other: 'Other',
  },
  interfaceDataCategories: {
    master_data: 'Master Data',
    transactional: 'Transactional',
    reporting: 'Reporting',
    control: 'Control',
  },
  interfaceTriggerTypes: {
    event_based: 'Event-based',
    scheduled: 'Scheduled',
    on_demand: 'On-demand',
    real_time: 'Real-time',
  },
  interfacePatterns: {
    rest_api_sync: 'REST API (sync)',
    rest_api_async: 'REST API (async / callback)',
    soap_webservice: 'SOAP web service',
    file_transfer_batch: 'File transfer (batch)',
    message_queue: 'Message queue (point-to-point)',
    pub_sub_topic: 'Pub/Sub (topic)',
    etl_batch: 'ETL batch job',
    db_link_view: 'DB link / direct DB read',
    scheduled_job: 'Scheduled script / job',
    manual_import_export: 'Manual import / export',
    other: 'Other',
  },
  interfaceFormats: {
    delimited: 'Delimited text',
    fixed_width: 'Fixed-width text',
    txt_plain: 'Plain text',
    binary_custom: 'Binary (custom)',
    other: 'Other',
  },
  interfaceAuthModes: {
    service_account: 'Service account',
    api_key: 'API key',
    certificate: 'Certificate',
    none: 'None',
  },
  connectionTypes: {
    zabbix: 'Zabbix Agent',
    'ad-repl': 'AD Replication',
    tcp: 'TCP (custom)',
    udp: 'UDP (custom)',
    other: 'Other',
    unknown: 'Unknown',
  },
  ipAddressTypes: {
    host: 'Host',
    management: 'Management',
  },
  accessMethods: {
    local: 'Locally installed application',
    mobile: 'Mobile application',
    hmi: 'Proprietary HMI (industrial interface)',
    terminal: 'Terminal / CLI',
    vdi: 'VDI / Remote Desktop',
    kiosk: 'Kiosk',
  },
  pathHopFunctions: {
    vip: 'Virtual IP',
    firewall: 'Firewall',
    reverse_proxy: 'Reverse proxy',
    load_balancer: 'Load balancer',
    api_gateway: 'API gateway',
    vpn_endpoint: 'VPN endpoint',
    bastion: 'Bastion / jump host',
    cdn_edge: 'CDN edge',
    service_mesh: 'Service mesh proxy',
  },
  incidentCategories: {
    infrastructure: 'Infrastructure',
    security: 'Security',
    application: 'Application',
    data: 'Data',
    supplier: 'Supplier',
    other: 'Other',
  },
  domains: {
    workgroup: 'Workgroup',
    'n-a': 'N/A',
  },
};

const SHIPPED: Record<string, Record<string, DefaultCopy>> = Object.fromEntries(
  Object.entries(SHIPPED_LABELS).map(([list, labels]) => [
    list,
    Object.fromEntries(Object.entries(labels).map(([code, label]) => [code, { label }])),
  ]),
);

/** Shipped defaults of an IT Ops catalog list, for the display projection; undefined for a list with none. */
export function itOpsCatalogDefaults(list: string): CatalogDefaults | undefined {
  const source = SHIPPED[list];
  if (!source) return undefined;
  return {
    source,
    translated: (locale, code) => {
      const label = i18n.getResource(locale, 'it', `catalogDefaults.${list}.${code}`);
      return typeof label === 'string' ? { label } : undefined;
    },
  };
}


/**
 * The categories of the shipped connection types (`category` of `defaultConnectionTypes` in the
 * backend), by English text. A category is free text with no code: one still written as shipped is
 * shown in the user's language (`it:catalogDefaults.connectionTypeCategories.<key>`).
 */
const SHIPPED_CONNECTION_TYPE_CATEGORIES: Record<string, string> = {
  'Application': 'application',
  'Database': 'database',
  'Authentication': 'authentication',
  'Remote Access': 'remote_access',
  'File Transfer': 'file_transfer',
  'File Sharing': 'file_sharing',
  'Storage': 'storage',
  'Messaging': 'messaging',
  'Email': 'email',
  'Monitoring': 'monitoring',
  'Network Services': 'network_services',
  'Replication': 'replication',
  'VPN / Tunnel': 'vpn_tunnel',
  'Backup': 'backup',
  'Generic': 'generic',
};

/** A connection type category as shown in `locale`: translated when it is a shipped one, as typed otherwise. */
export function connectionTypeCategoryLabel(category: string, locale: string): string {
  const key = Object.prototype.hasOwnProperty.call(SHIPPED_CONNECTION_TYPE_CATEGORIES, category) ? SHIPPED_CONNECTION_TYPE_CATEGORIES[category] : undefined;
  if (!key) return category;
  const label = i18n.getResource(locale, 'it', `catalogDefaults.connectionTypeCategories.${key}`);
  return typeof label === 'string' ? label : category;
}
