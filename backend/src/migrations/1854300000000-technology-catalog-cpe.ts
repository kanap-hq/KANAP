import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The CPE identifiers the catalog gained when it was checked against the NVD (lot C3), given to the
 * technologies already adopted from it: an adopted entry is not adopted again, so they would never
 * receive them otherwise.
 *
 * For each technology of a tenant whose `catalog_key` names an entry below:
 * 1. the identifiers of `ADDED_CPE` it lacks are added to `cpe_products` (none is removed, so an
 *    identifier the tenant removed by hand comes back only if it is one of these);
 * 2. each version whose label equals (without case) one of `CPE_VERSIONS` receives that
 *    `cpe_version` when it has none, or when it holds exactly the value the catalog gave that label
 *    before (`2016` for SQL Server 2016 SP3): SQL Server 2016 to 2025 compared on their build line,
 *    Exchange Subscription Edition. Any other value set by the tenant is kept.
 *
 * The lists are frozen here, from the catalog shipped with this migration: a later update of
 * `technologies.catalog.json` does not change what this migration does. Tenant by tenant with
 * `app.current_tenant` set (RLS FORCE, and the search index trigger on `technologies`); counts
 * logged. A rerun finds nothing to add. The vulnerabilities of the technologies touched follow at
 * the next scheduled run of the feed, which collects every CVE of a product it did not follow yet.
 *
 * down() changes nothing: the identifiers added cannot be told apart from those set by hand.
 */

/** Catalog key → identifiers added by lot C3 (2026-10-17). */
export const ADDED_CPE: Record<string, string[]> = {
  'amazon-corretto': ['a:oracle:jdk', 'a:oracle:openjdk'],
  'apache-artemis': ['a:apache:artemis'],
  'azure-kubernetes-service': ['a:microsoft:azure_kubernetes_service'],
  'bind-9': ['a:isc:bind'],
  caddy: ['a:caddy_project:caddy'],
  centreon: ['a:centreon:centreon_web', 'a:merethis:centreon'],
  ceph: ['a:ceph:ceph', 'a:linuxfoundation:ceph', 'a:redhat:ceph'],
  checkmk: ['a:checkmk:checkmk', 'a:tribe29:checkmk'],
  'citrix-vad': ['a:citrix:virtual_apps_and_desktops'],
  clickhouse: ['a:clickhouse:clickhouse'],
  'docker-engine': ['a:docker:docker', 'a:mobyproject:moby'],
  dotnet: ['a:microsoft:.net_core'],
  dovecot: ['a:open-xchange:dovecot'],
  'eclipse-jetty': ['a:mortbay:jetty'],
  'eclipse-temurin': ['a:oracle:jdk', 'a:oracle:openjdk'],
  'entra-id': ['a:microsoft:azure_active_directory', 'a:microsoft:entra_id'],
  'google-kubernetes-engine': ['a:google:kubernetes_engine'],
  'ibm-mq': ['a:ibm:websphere_mq'],
  jenkins: ['a:cloudbees:jenkins'],
  'microsoft-build-of-openjdk': ['a:oracle:jdk', 'a:oracle:openjdk'],
  msexchange: ['a:microsoft:exchange_server_subscription_edition'],
  mssqlserver: [
    'a:microsoft:sql_server_2016', 'a:microsoft:sql_server_2017', 'a:microsoft:sql_server_2019',
    'a:microsoft:sql_server_2022', 'a:microsoft:sql_server_2025',
  ],
  'mulesoft-runtime': ['a:mulesoft:mule_runtime', 'a:salesforce:mule'],
  mysql: ['a:mysql:mysql'],
  opensearch: ['a:amazon:opensearch_security'],
  ovirt: ['a:ovirt:ovirt', 'a:ovirt:ovirt-engine', 'a:redhat:ovirt-engine'],
  powershell: ['a:microsoft:powershell_core'],
  'proxmox-backup-server': ['a:proxmox:backup_server'],
  puppet: ['a:puppetlabs:puppet'],
  rabbitmq: ['a:broadcom:rabbitmq_server'],
  rancher: ['a:rancher:rancher'],
  'red-hat-openshift': ['a:redhat:openshift_container_platform'],
  redis: ['a:redislabs:redis'],
  'redhat-jboss-eap': ['a:redhat:jboss_enterprise_application_platform'],
  'redhat-satellite': ['a:redhat:satellite'],
  samba: ['a:samba:samba'],
  traefik: ['a:containous:traefik'],
  'veeam-backup-and-replication': ['a:veeam:veeam_backup_\\&_replication'],
  'veeam-one': ['a:veeam:one'],
  zabbix: ['a:zabbix:zabbix_server'],
};

/** Catalog key, version label, `cpe_version` set by lot C3, the value the catalog gave before (or null). */
export const CPE_VERSIONS: Array<[string, string, string, string | null]> = [
  ['msexchange', 'Subscription Edition SU11', '15.2', null],
  ['mssqlserver', '2025', '17.0', null],
  ['mssqlserver', '2022', '16.0', null],
  ['mssqlserver', '2019', '15.0', null],
  ['mssqlserver', '2017', '14.0', null],
  ['mssqlserver', '2016 SP3', '13.0', '2016'],
  ['mssqlserver', '2016 SP3 Azure Connect Pack', '13.0', '2016'],
];

type Counts = { tenant_id: string; slug: string | null; identifiers: number; versions: number };

export class TechnologyCatalogCpe1854300000000 implements MigrationInterface {
  name = 'TechnologyCatalogCpe1854300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const pairs = Object.entries(ADDED_CPE).flatMap(([key, ids]) => ids.map((id) => [key, id] as const));
    const cpeKeys = pairs.map(([key]) => key);
    const cpeIds = pairs.map(([, id]) => id);
    const tenants: Array<{ id: string; slug: string | null }> = await queryRunner.query(
      `SELECT id::text AS id, slug FROM tenants ORDER BY created_at ASC, id ASC`,
    );
    const counts: Counts[] = [];
    try {
      for (const tenant of tenants) {
        await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
        const [identifiers]: Array<{ n: number }> = await queryRunner.query(
          `WITH added AS (
             SELECT key, array_agg(id ORDER BY id) AS ids FROM unnest($2::text[], $3::text[]) AS a(key, id) GROUP BY key
           ), changed AS (
             UPDATE technologies t
                SET cpe_products = ARRAY(SELECT DISTINCT p FROM unnest(t.cpe_products || a.ids) AS p ORDER BY 1),
                    updated_at = now()
               FROM added a
              WHERE t.tenant_id = $1 AND t.catalog_key = a.key AND NOT (a.ids <@ t.cpe_products)
             RETURNING 1
           )
           SELECT count(*)::int AS n FROM changed`,
          [tenant.id, cpeKeys, cpeIds],
        );
        const [versions]: Array<{ n: number }> = await queryRunner.query(
          `WITH changed AS (
             UPDATE technology_versions v
                SET cpe_version = c.cpe_version, updated_at = now()
               FROM technologies t, unnest($2::text[], $3::text[], $4::text[], $5::text[]) AS c(key, label, cpe_version, previous)
              WHERE v.tenant_id = $1 AND t.tenant_id = $1 AND t.id = v.technology_id
                AND t.catalog_key = c.key AND lower(v.label) = lower(c.label)
                AND (v.cpe_version IS NULL OR v.cpe_version = c.previous)
             RETURNING 1
           )
           SELECT count(*)::int AS n FROM changed`,
          [tenant.id, CPE_VERSIONS.map(([key]) => key), CPE_VERSIONS.map(([, label]) => label), CPE_VERSIONS.map(([, , version]) => version), CPE_VERSIONS.map(([, , , previous]) => previous)],
        );
        if (identifiers.n || versions.n) counts.push({ tenant_id: tenant.id, slug: tenant.slug, identifiers: identifiers.n, versions: versions.n });
      }
    } finally {
      await queryRunner.query(`SELECT set_config('app.current_tenant', '', true)`);
    }
    logCounts(counts, tenants.length);
  }

  public async down(): Promise<void> {
    // Nothing to undo: the identifiers and CPE versions added stay (see the class comment).
  }
}

function logCounts(counts: Counts[], tenants: number) {
  const prefix = '[Migration] TechnologyCatalogCpe:';
  for (const row of counts) {
    console.log(`${prefix} tenant ${row.slug ?? '(unknown)'} (${row.tenant_id}): ${row.identifiers} technologies completed, ${row.versions} CPE versions set`);
  }
  const technologies = counts.reduce((n, row) => n + row.identifiers, 0);
  const versions = counts.reduce((n, row) => n + row.versions, 0);
  console.log(`${prefix} ${tenants} tenants read, ${technologies} technologies completed, ${versions} CPE versions set`);
}
