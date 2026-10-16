#!/usr/bin/env node
// Builds backend/src/technologies/catalog/technologies.catalog.json, the starting catalog of
// technologies KANAP ships (plan planning/cartographie-technologies.md, lot S): common products by
// family, with their editor, CPE product identifiers, major versions and end-of-support dates.
//
// Source: the open API of endoflife.date (https://endoflife.date/docs/api/v1/), whose data is
// published under the MIT license (Copyright 2020 endoflife.date contributors; the notice is in
// backend/src/technologies/catalog/LICENSE-endoflife-date.txt). The products kept are listed below
// (PRODUCTS); a few have no endoflife.date page and are written from this list only (`slug` null).
// Operating systems are not in this catalog: they come with lot T3.
//
// Usage: node scripts/technologies/build-catalog.mjs [--out <file>] [--today YYYY-MM-DD]
//        node scripts/technologies/build-catalog.mjs --refresh-cpe-versions [--out <file>]
//        (recomputes `cpe_version` in the existing file with `cpeVersionOf` and adds the `cpe`
//        identifiers of PRODUCTS to `cpe_products`, without the network)
// Reproducible: the same answers from the API give the same file (sorted keys, no timestamp
// besides `source.retrieved_on`, the day passed with --today or the current day).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_OUT = resolve(ROOT, 'backend/src/technologies/catalog/technologies.catalog.json');
const API = 'https://endoflife.date/api/v1/products';

/** Versions kept per product: the newest released ones, at most this many. */
const MAX_VERSIONS = 8;
/** Versions whose last support ended more than this many years ago are left out. */
const ENDED_YEARS_KEPT = 4;

/**
 * The products kept, by family (codes of `DEFAULT_TECHNOLOGY_FAMILIES`). `key`: the catalog key
 * stored on an adopted technology (`technologies.catalog_key`). `cpe`: identifiers added to the
 * ones endoflife.date publishes (`part:vendor:product`). `mode`: `subscribed` for a service.
 * `cpeVersion: 'label'`: the label is the NVD version as it stands (see `cpeVersionOf`).
 */
const PRODUCTS = [
  // Databases
  { key: 'mssqlserver', slug: 'mssqlserver', name: 'Microsoft SQL Server', editor: 'Microsoft', family: 'database' },
  { key: 'oracle-database', slug: 'oracle-database', name: 'Oracle Database', editor: 'Oracle', family: 'database', cpe: ['a:oracle:database', 'a:oracle:database_server'], cpeVersion: 'label' },
  { key: 'postgresql', slug: 'postgresql', name: 'PostgreSQL', editor: 'PostgreSQL Global Development Group', family: 'database' },
  { key: 'mysql', slug: 'mysql', name: 'MySQL', editor: 'Oracle', family: 'database' },
  { key: 'mariadb', slug: 'mariadb', name: 'MariaDB', editor: 'MariaDB Foundation', family: 'database' },
  { key: 'mongodb', slug: 'mongodb', name: 'MongoDB', editor: 'MongoDB', family: 'database' },
  { key: 'redis', slug: 'redis', name: 'Redis', editor: 'Redis', family: 'database' },
  { key: 'valkey', slug: 'valkey', name: 'Valkey', editor: 'Linux Foundation', family: 'database' },
  { key: 'ibm-db2', slug: 'ibm-db2', name: 'IBM Db2', editor: 'IBM', family: 'database' },
  { key: 'elasticsearch', slug: 'elasticsearch', name: 'Elasticsearch', editor: 'Elastic', family: 'database' },
  { key: 'opensearch', slug: 'opensearch', name: 'OpenSearch', editor: 'OpenSearch Project', family: 'database' },
  { key: 'apache-cassandra', slug: 'apache-cassandra', name: 'Apache Cassandra', editor: 'Apache Software Foundation', family: 'database' },
  { key: 'influxdb', slug: 'influxdb', name: 'InfluxDB', editor: 'InfluxData', family: 'database' },
  { key: 'couchbase-server', slug: 'couchbase-server', name: 'Couchbase Server', editor: 'Couchbase', family: 'database' },
  { key: 'neo4j', slug: 'neo4j', name: 'Neo4j', editor: 'Neo4j', family: 'database' },
  { key: 'clickhouse', slug: 'clickhouse', name: 'ClickHouse', editor: 'ClickHouse', family: 'database' },
  { key: 'memcached', slug: 'memcached', name: 'Memcached', editor: 'Memcached', family: 'database' },
  // Application servers
  { key: 'tomcat', slug: 'tomcat', name: 'Apache Tomcat', editor: 'Apache Software Foundation', family: 'application_server' },
  { key: 'eclipse-jetty', slug: 'eclipse-jetty', name: 'Eclipse Jetty', editor: 'Eclipse Foundation', family: 'application_server' },
  { key: 'redhat-jboss-eap', slug: 'redhat-jboss-eap', name: 'Red Hat JBoss EAP', editor: 'Red Hat', family: 'application_server' },
  // Web servers and proxies
  { key: 'apache-http-server', slug: 'apache-http-server', name: 'Apache HTTP Server', editor: 'Apache Software Foundation', family: 'web_server' },
  { key: 'nginx', slug: 'nginx', name: 'NGINX', editor: 'F5', family: 'web_server' },
  { key: 'haproxy', slug: 'haproxy', name: 'HAProxy', editor: 'HAProxy Technologies', family: 'web_server' },
  { key: 'traefik', slug: 'traefik', name: 'Traefik', editor: 'Traefik Labs', family: 'web_server' },
  { key: 'caddy', slug: 'caddy', name: 'Caddy', editor: 'Caddy', family: 'web_server' },
  { key: 'squid', slug: 'squid', name: 'Squid', editor: 'Squid Cache', family: 'web_server' },
  // Hypervisors and virtualisation management
  { key: 'vsphere', slug: 'vcenter', name: 'VMware vSphere', editor: 'Broadcom', family: 'hypervisor', cpe: ['o:vmware:esxi'] },
  { key: 'nutanix-prism', slug: 'nutanix-prism', name: 'Nutanix Prism', editor: 'Nutanix', family: 'hypervisor' },
  { key: 'ovirt', slug: 'ovirt', name: 'oVirt', editor: 'oVirt', family: 'hypervisor' },
  { key: 'citrix-vad', slug: 'citrix-vad', name: 'Citrix Virtual Apps and Desktops', editor: 'Citrix', family: 'hypervisor' },
  // Containers
  { key: 'kubernetes', slug: 'kubernetes', name: 'Kubernetes', editor: 'Cloud Native Computing Foundation', family: 'container' },
  { key: 'docker-engine', slug: 'docker-engine', name: 'Docker Engine', editor: 'Docker', family: 'container' },
  { key: 'containerd', slug: 'containerd', name: 'containerd', editor: 'Cloud Native Computing Foundation', family: 'container' },
  { key: 'podman', slug: 'podman', name: 'Podman', editor: 'Red Hat', family: 'container' },
  { key: 'red-hat-openshift', slug: 'red-hat-openshift', name: 'Red Hat OpenShift', editor: 'Red Hat', family: 'container' },
  { key: 'rancher', slug: 'rancher', name: 'Rancher', editor: 'SUSE', family: 'container' },
  { key: 'harbor', slug: 'harbor', name: 'Harbor', editor: 'Cloud Native Computing Foundation', family: 'container' },
  { key: 'amazon-eks', slug: 'amazon-eks', name: 'Amazon EKS', editor: 'Amazon Web Services', family: 'container', mode: 'subscribed' },
  { key: 'azure-kubernetes-service', slug: 'azure-kubernetes-service', name: 'Azure Kubernetes Service', editor: 'Microsoft', family: 'container', mode: 'subscribed' },
  { key: 'google-kubernetes-engine', slug: 'google-kubernetes-engine', name: 'Google Kubernetes Engine', editor: 'Google', family: 'container', mode: 'subscribed' },
  // Directory and identity
  { key: 'active-directory', slug: null, name: 'Active Directory', editor: 'Microsoft', family: 'directory' },
  { key: 'entra-id', slug: null, name: 'Microsoft Entra ID', editor: 'Microsoft', family: 'directory', mode: 'subscribed' },
  { key: 'keycloak', slug: 'keycloak', name: 'Keycloak', editor: 'Red Hat', family: 'directory' },
  { key: 'samba', slug: 'samba', name: 'Samba', editor: 'Samba Team', family: 'directory' },
  { key: 'authentik', slug: 'authentik', name: 'authentik', editor: 'Authentik Security', family: 'directory' },
  // Messaging
  { key: 'msexchange', slug: 'msexchange', name: 'Microsoft Exchange Server', editor: 'Microsoft', family: 'messaging' },
  { key: 'rabbitmq', slug: 'rabbitmq', name: 'RabbitMQ', editor: 'Broadcom', family: 'messaging' },
  { key: 'apache-kafka', slug: 'apache-kafka', name: 'Apache Kafka', editor: 'Apache Software Foundation', family: 'messaging' },
  { key: 'apache-activemq', slug: 'apache-activemq', name: 'Apache ActiveMQ', editor: 'Apache Software Foundation', family: 'messaging' },
  { key: 'apache-artemis', slug: 'apache-artemis', name: 'Apache ActiveMQ Artemis', editor: 'Apache Software Foundation', family: 'messaging' },
  { key: 'ibm-mq', slug: 'ibm-mq', name: 'IBM MQ', editor: 'IBM', family: 'messaging' },
  { key: 'postfix', slug: 'postfix', name: 'Postfix', editor: 'Postfix', family: 'messaging' },
  { key: 'dovecot', slug: 'dovecot', name: 'Dovecot', editor: 'Open-Xchange', family: 'messaging' },
  // Integration
  { key: 'mulesoft-runtime', slug: 'mulesoft-runtime', name: 'MuleSoft Mule runtime', editor: 'Salesforce', family: 'integration' },
  { key: 'apache-nifi', slug: 'apache-nifi', name: 'Apache NiFi', editor: 'Apache Software Foundation', family: 'integration' },
  { key: 'kong-gateway', slug: 'kong-gateway', name: 'Kong Gateway', editor: 'Kong', family: 'integration' },
  { key: 'apache-apisix', slug: 'apache-apisix', name: 'Apache APISIX', editor: 'Apache Software Foundation', family: 'integration' },
  // Backup
  { key: 'veeam-backup-and-replication', slug: 'veeam-backup-and-replication', name: 'Veeam Backup & Replication', editor: 'Veeam', family: 'backup' },
  { key: 'veeam-backup-for-microsoft-365', slug: 'veeam-backup-for-microsoft-365', name: 'Veeam Backup for Microsoft 365', editor: 'Veeam', family: 'backup' },
  { key: 'commvault', slug: 'commvault', name: 'Commvault', editor: 'Commvault', family: 'backup' },
  { key: 'proxmox-backup-server', slug: 'proxmox-backup-server', name: 'Proxmox Backup Server', editor: 'Proxmox', family: 'backup' },
  // Monitoring
  { key: 'zabbix', slug: 'zabbix', name: 'Zabbix', editor: 'Zabbix', family: 'monitoring' },
  { key: 'grafana', slug: 'grafana', name: 'Grafana', editor: 'Grafana Labs', family: 'monitoring' },
  { key: 'prometheus', slug: 'prometheus', name: 'Prometheus', editor: 'Cloud Native Computing Foundation', family: 'monitoring' },
  { key: 'checkmk', slug: 'checkmk', name: 'Checkmk', editor: 'Checkmk', family: 'monitoring' },
  { key: 'centreon', slug: 'centreon', name: 'Centreon', editor: 'Centreon', family: 'monitoring' },
  { key: 'icinga', slug: 'icinga', name: 'Icinga', editor: 'Icinga', family: 'monitoring' },
  { key: 'splunk', slug: 'splunk', name: 'Splunk Enterprise', editor: 'Splunk', family: 'monitoring' },
  { key: 'graylog', slug: 'graylog', name: 'Graylog', editor: 'Graylog', family: 'monitoring' },
  { key: 'veeam-one', slug: 'veeam-one', name: 'Veeam ONE', editor: 'Veeam', family: 'monitoring' },
  // Runtimes and frameworks
  { key: 'dotnet', slug: 'dotnet', name: '.NET', editor: 'Microsoft', family: 'runtime' },
  { key: 'dotnetfx', slug: 'dotnetfx', name: '.NET Framework', editor: 'Microsoft', family: 'runtime', cpe: ['a:microsoft:.net_framework'] },
  { key: 'nodejs', slug: 'nodejs', name: 'Node.js', editor: 'OpenJS Foundation', family: 'runtime' },
  { key: 'python', slug: 'python', name: 'Python', editor: 'Python Software Foundation', family: 'runtime' },
  { key: 'php', slug: 'php', name: 'PHP', editor: 'The PHP Group', family: 'runtime' },
  { key: 'oracle-jdk', slug: 'oracle-jdk', name: 'Oracle JDK', editor: 'Oracle', family: 'runtime' },
  { key: 'eclipse-temurin', slug: 'eclipse-temurin', name: 'Eclipse Temurin', editor: 'Eclipse Foundation', family: 'runtime' },
  { key: 'amazon-corretto', slug: 'amazon-corretto', name: 'Amazon Corretto', editor: 'Amazon Web Services', family: 'runtime' },
  { key: 'microsoft-build-of-openjdk', slug: 'microsoft-build-of-openjdk', name: 'Microsoft Build of OpenJDK', editor: 'Microsoft', family: 'runtime' },
  { key: 'go', slug: 'go', name: 'Go', editor: 'Google', family: 'runtime' },
  { key: 'ruby', slug: 'ruby', name: 'Ruby', editor: 'Ruby', family: 'runtime' },
  { key: 'powershell', slug: 'powershell', name: 'PowerShell', editor: 'Microsoft', family: 'runtime' },
  // Storage
  { key: 'ceph', slug: 'ceph', name: 'Ceph', editor: 'Ceph Foundation', family: 'storage' },
  { key: 'nutanix-files', slug: 'nutanix-files', name: 'Nutanix Files', editor: 'Nutanix', family: 'storage' },
  // Network and security
  { key: 'hashicorp-vault', slug: 'hashicorp-vault', name: 'HashiCorp Vault', editor: 'HashiCorp', family: 'network_security' },
  { key: 'bind-9', slug: 'bind-9', name: 'BIND 9', editor: 'ISC', family: 'network_security' },
  { key: 'opnsense', slug: 'opnsense', name: 'OPNsense', editor: 'Deciso', family: 'network_security' },
  // Administration
  { key: 'ansible-automation-platform', slug: 'red-hat-ansible-automation-platform', name: 'Red Hat Ansible Automation Platform', editor: 'Red Hat', family: 'administration' },
  { key: 'puppet', slug: 'puppet', name: 'Puppet', editor: 'Perforce', family: 'administration' },
  { key: 'redhat-satellite', slug: 'redhat-satellite', name: 'Red Hat Satellite', editor: 'Red Hat', family: 'administration' },
  { key: 'jenkins', slug: 'jenkins', name: 'Jenkins', editor: 'Jenkins', family: 'administration' },
];

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** `cpe:2.3:a:vendor:product` or `cpe:/a:vendor:product` to `a:vendor:product`, lower case. */
function cpeProduct(id) {
  const parts = String(id).replace(/^cpe:2\.3:/, '').replace(/^cpe:\//, '').split(':');
  if (parts.length < 3 || !/^[aoh]$/.test(parts[0])) return null;
  return `${parts[0]}:${parts[1]}:${parts[2]}`.toLowerCase();
}

/** "2022 'Dallas'", "24 (LTS)" → "2022", "24". */
function cleanLabel(label, name) {
  const text = String(label ?? name ?? '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s*'.*?'\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return text || String(name);
}

/**
 * The NVD version of a release (`cpe_version`), read by the vulnerability matching (lot T6a) in
 * place of the label, which compares on its numeric prefix:
 * - a label that is a version (`9.0`, `2019`) or starts with one glued to letters (`21c`, `2024E`)
 *   needs none: null;
 * - a label whose number is not in front, or followed by words, gives that number:
 *   `IBM MQ 9.4 LTS` → `9.4`, `Core 3.1` → `3.1`, `2016 SP3` → `2016`, `2019 CU15 SU5` → `2019`
 *   (the NVD writes `sql_server:2016` and `exchange_server:2019`, the service pack or cumulative
 *   update in the `update` component); a label without such a number stays null (`Subscription
 *   Edition SU11`: the label stands for it, counted as concerned);
 * - Oracle Database (`cpeVersion: 'label'`): the NVD names the releases `database_server:19c`,
 *   `21c` in its exact criteria and ranges them in numbers (`19.3` to `19.22`); the label in lower
 *   case matches both, `19c` being 19 with a qualifier.
 */
function cpeVersionOf(label, entry) {
  const text = String(label ?? '').trim();
  if (entry?.cpeVersion === 'label') return text.toLowerCase() || null;
  if (/^v?\d+(\.\d+)*[a-z]*$/i.test(text)) return null;
  return text.split(/\s+/).find((token) => /^\d+(\.\d+)*$/.test(token)) ?? null;
}

const day = (value) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);

function versionsOf(releases, today, entry) {
  const cutoff = `${Number(today.slice(0, 4)) - ENDED_YEARS_KEPT}${today.slice(4)}`;
  const out = [];
  const seen = new Set();
  const sorted = [...releases].sort((a, b) => String(b.releaseDate ?? '').localeCompare(String(a.releaseDate ?? '')));
  for (const release of sorted) {
    if (!release.releaseDate || release.releaseDate > today) continue;
    const eoas = day(release.eoasFrom);
    const eol = day(release.eolFrom);
    const eoes = day(release.eoesFrom);
    const lastEnd = [eoas, eol, eoes].filter(Boolean).sort().at(-1) ?? null;
    if (lastEnd && lastEnd < cutoff) continue;
    const label = cleanLabel(release.label, release.name);
    if (seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    // Standard support: the end of active support when the product has one, else the end of life.
    // Extended: the paid extension when published, else the end of life after an active support.
    const standard = eoas ?? eol;
    let extended = eoes ?? (eoas ? eol : null);
    if (standard && extended && extended < standard) extended = null;
    const name = String(release.name);
    out.push({
      key: name,
      label,
      cpe_version: cpeVersionOf(label, entry),
      build_prefixes: name !== label && /^\d+(\.\d+)*$/.test(name) ? [name] : [],
      release_date: day(release.releaseDate),
      standard_support_end: standard,
      extended_support_end: extended === standard ? null : extended,
    });
    if (out.length >= MAX_VERSIONS) break;
  }
  return out;
}

async function fetchProduct(slug) {
  const response = await fetch(`${API}/${slug}`, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${slug}: HTTP ${response.status}`);
  return (await response.json()).result;
}

/**
 * `--refresh-cpe-versions`: the existing file with `cpe_version` recomputed and the `cpe` of
 * PRODUCTS added to `cpe_products` (the endoflife.date identifiers already in the file are kept),
 * nothing fetched.
 */
function refreshCpeVersions(out) {
  const catalog = JSON.parse(readFileSync(out, 'utf8'));
  let changed = 0;
  let added = 0;
  for (const product of catalog.products) {
    const entry = PRODUCTS.find((p) => p.key === product.key);
    const cpe = new Set(product.cpe_products);
    for (const extra of entry?.cpe ?? []) cpe.add(extra.toLowerCase());
    added += cpe.size - product.cpe_products.length;
    product.cpe_products = [...cpe].sort();
    for (const version of product.versions) {
      const next = cpeVersionOf(version.label, entry);
      if (next !== version.cpe_version) changed += 1;
      version.cpe_version = next;
    }
  }
  writeFileSync(out, `${JSON.stringify(catalog, null, 2)}\n`);
  process.stderr.write(`${changed} CPE versions changed, ${added} CPE products added in ${out}\n`);
}

async function main() {
  const out = resolve(argValue('--out') ?? DEFAULT_OUT);
  if (process.argv.includes('--refresh-cpe-versions')) return refreshCpeVersions(out);
  const today = argValue('--today') ?? new Date().toISOString().slice(0, 10);
  const products = [];
  for (const entry of PRODUCTS) {
    const remote = entry.slug ? await fetchProduct(entry.slug) : null;
    const cpe = new Set();
    for (const identifier of remote?.identifiers ?? []) {
      if (identifier.type !== 'cpe') continue;
      const product = cpeProduct(identifier.id);
      if (product) cpe.add(product);
    }
    for (const extra of entry.cpe ?? []) cpe.add(extra.toLowerCase());
    products.push({
      key: entry.key,
      name: entry.name,
      editor: entry.editor,
      family: entry.family,
      mode: entry.mode ?? 'installed',
      cpe_products: [...cpe].sort(),
      source_url: entry.slug ? `https://endoflife.date/${entry.slug}` : null,
      versions: remote ? versionsOf(remote.releases ?? [], today, entry) : [],
    });
    process.stderr.write(`${entry.key}: ${products.at(-1).versions.length} versions, ${cpe.size} CPE\n`);
  }
  products.sort((a, b) => a.family.localeCompare(b.family) || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  const catalog = {
    source: {
      name: 'endoflife.date',
      url: 'https://endoflife.date',
      license: 'MIT',
      copyright: 'Copyright 2020 endoflife.date contributors',
      retrieved_on: today,
      script: 'scripts/technologies/build-catalog.mjs',
    },
    products,
  };
  writeFileSync(out, `${JSON.stringify(catalog, null, 2)}\n`);
  process.stderr.write(`${products.length} products written to ${out}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
