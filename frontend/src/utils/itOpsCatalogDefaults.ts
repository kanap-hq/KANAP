import i18n from 'i18next';
import type { CatalogDefaults, DefaultCopy } from './catalogLocalization';

/**
 * The asset types and server roles every tenant starts with, as the backend ships them
 * (`defaultServerKinds` and `defaultServerRoles` in backend/src/it-ops-settings/it-ops-settings.service.ts).
 * A value that keeps its code and this English label is shown in the user's language
 * (`it:catalogDefaults.<list>.<code>`); a renamed or added value shows its own label.
 */
const SHIPPED: Record<'serverKinds' | 'serverRoles', Record<string, DefaultCopy>> = {
  serverKinds: {
    physical_server: { label: 'Physical Server' },
    virtual_machine: { label: 'Virtual Machine' },
    container: { label: 'Container' },
    serverless: { label: 'Serverless' },
    appliance: { label: 'Appliance' },
    saas: { label: 'SaaS' },
    other: { label: 'Other' },
    switch: { label: 'Switch' },
    firewall: { label: 'Firewall' },
    load_balancer: { label: 'Load Balancer' },
    access_point: { label: 'Access Point' },
    san: { label: 'SAN' },
    nas: { label: 'NAS' },
    backup_appliance: { label: 'Backup Appliance' },
    tape_library: { label: 'Tape Library' },
    industrial_robot: { label: 'Industrial Robot' },
    industrial_machine: { label: 'Industrial Machine' },
    rack: { label: 'Rack' },
  },
  serverRoles: {
    app: { label: 'Application server' },
    backup: { label: 'Backup server' },
    'cloud-service': { label: 'Cloud service' },
    db: { label: 'Database server' },
    'domain-controller': { label: 'Domain controller' },
    file: { label: 'File server' },
    mail: { label: 'Mail / messaging' },
    monitoring: { label: 'Monitoring server' },
    other: { label: 'Other' },
    print: { label: 'Print server' },
    proxy: { label: 'Proxy / gateway' },
    'remote-desktop': { label: 'Remote desktop' },
    virtualization: { label: 'Virtualization host' },
    web: { label: 'Web server' },
  },
};

/** Shipped defaults of an IT Ops catalog list, for the display projection; undefined for the other lists. */
export function itOpsCatalogDefaults(list: string): CatalogDefaults | undefined {
  if (list !== 'serverKinds' && list !== 'serverRoles') return undefined;
  const source = SHIPPED[list];
  return {
    source,
    translated: (locale, code) => {
      const label = i18n.getResource(locale, 'it', `catalogDefaults.${list}.${code}`);
      return typeof label === 'string' ? { label } : undefined;
    },
  };
}
