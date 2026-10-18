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
//        (recomputes `cpe_version` in the existing file with `cpeVersionOf`, adds the `cpe`
//        identifiers of PRODUCTS to `cpe_products` and copies their `hosting_type`, without the network)
//        node scripts/technologies/build-catalog.mjs --check-cpe [--nvd [--only k1,k2] [--latest]
//                                                     [--report <file>]]
//        (checks the CPE identifiers of the file against PRODUCTS: syntax, and an entry without
//        any must say why in `noCpe`; and that each entry has its four descriptions in
//        technologies.descriptions.json; offline by default. With --nvd, asks the CPE dictionary of
//        the NVD whether each `part:vendor:product` exists and how many CVE name it, --latest
//        adds the newest CVE; one request every 6.5 s, the rate allowed without an API key)
//        node scripts/technologies/build-catalog.mjs --nvd-count <a:vendor:product,...> [--latest]
//        (the same NVD counts for identifiers not in the catalog yet, before adding them)
//        node scripts/technologies/build-catalog.mjs --nvd-search <keywords | cpe:2.3:...>
//        (the `part:vendor:product` identifiers of the CPE dictionary whose titles hold these
//        words, or that match a CPE pattern such as `cpe:2.3:*:*:nginx` (any part and vendor),
//        with their number of CPE names: how a missing identifier or a second name is found)
// Reproducible: the same answers from the API give the same file (sorted keys, no timestamp
// besides `source.retrieved_on`, the day passed with --today or the current day).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_OUT = resolve(ROOT, 'backend/src/technologies/catalog/technologies.catalog.json');
/**
 * The short descriptions of the entries in en, fr, de and es, written by hand: a file of their own
 * that this script reads (--check-cpe) and never writes, so a rebuild keeps them.
 */
const DESCRIPTIONS = resolve(ROOT, 'backend/src/technologies/catalog/technologies.descriptions.json');
const API = 'https://endoflife.date/api/v1/products';

/** Versions kept per product: the newest released ones, at most this many. */
const MAX_VERSIONS = 8;
/** Versions whose last support ended more than this many years ago are left out. */
const ENDED_YEARS_KEPT = 4;

/**
 * SQL Server since 2024: the NVD files each release under a product of its own
 * (`sql_server_2022`, bounded in build numbers), where the CVE before named `sql_server:2022`. The
 * versions keep their year: the matching applies a product named for a release to the versions
 * whose label starts with that year (`productRelease` in backend/src/vulnerabilities/vulnerability-rules.ts).
 */
/**
 * The OpenJDK builds (Temurin, Corretto, Microsoft): the NVD files the Java SE CVE, fixed in every
 * OpenJDK build of the same quarterly update, under Oracle's products (`oracle:jdk`, with `jre`
 * on the same CVE), and named `oracle:openjdk` until January 2024.
 */
const OPENJDK_CPE = ['a:oracle:jdk', 'a:oracle:openjdk'];

/**
 * The products kept, by family (codes of `DEFAULT_TECHNOLOGY_FAMILIES`). `key`: the catalog key
 * stored on an adopted technology (`technologies.catalog_key`). `cpe`: identifiers added to the
 * ones endoflife.date publishes (`part:vendor:product`). `mode`: `subscribed` for a service.
 * `hosting_type`: a code of the default hosting types (`on_prem`, `colocation`, `public_cloud`,
 * `private_cloud`, `saas`) when `mode` says too little (a managed cloud service is `public_cloud`,
 * where `subscribed` alone gives `saas`); the adoption writes it in place of the one of `mode`.
 * `cpeVersion: 'label'`: the label is the NVD version as it stands; `cpeVersions`: `[pattern,
 * version]` for labels without a usable number (see `cpeVersionOf`).
 * `cpeExclude`: identifiers published by endoflife.date that the NVD does not use for this product.
 * `noCpe`: why an entry has no identifier (checked by --check-cpe); it drops any published one. Every identifier kept was
 * checked against the NVD with --check-cpe --nvd (lot C3, 2026-10-17): it exists in the CPE
 * dictionary and CVE name it.
 */
const PRODUCTS = [
  // Databases
  { key: 'mssqlserver', slug: 'mssqlserver', name: 'Microsoft SQL Server', editor: 'Microsoft', family: 'database', cpe: ['a:microsoft:sql_server_2016', 'a:microsoft:sql_server_2017', 'a:microsoft:sql_server_2019', 'a:microsoft:sql_server_2022', 'a:microsoft:sql_server_2025'] },
  { key: 'oracle-database', slug: 'oracle-database', name: 'Oracle Database', editor: 'Oracle', family: 'database', cpe: ['a:oracle:database', 'a:oracle:database_server'], cpeVersion: 'label' },
  { key: 'postgresql', slug: 'postgresql', name: 'PostgreSQL', editor: 'PostgreSQL Global Development Group', family: 'database' },
  { key: 'mysql', slug: 'mysql', name: 'MySQL', editor: 'Oracle', family: 'database', cpe: ['a:mysql:mysql'] },
  { key: 'mariadb', slug: 'mariadb', name: 'MariaDB', editor: 'MariaDB Foundation', family: 'database' },
  { key: 'mongodb', slug: 'mongodb', name: 'MongoDB', editor: 'MongoDB', family: 'database', cpeExclude: ['a:mongodb-org-server:mongodb-org-server'] },
  { key: 'redis', slug: 'redis', name: 'Redis', editor: 'Redis', family: 'database', cpe: ['a:redislabs:redis'] },
  { key: 'valkey', slug: 'valkey', name: 'Valkey', editor: 'Linux Foundation', family: 'database' },
  { key: 'ibm-db2', slug: 'ibm-db2', name: 'IBM Db2', editor: 'IBM', family: 'database' },
  { key: 'elasticsearch', slug: 'elasticsearch', name: 'Elasticsearch', editor: 'Elastic', family: 'database' },
  { key: 'opensearch', slug: 'opensearch', name: 'OpenSearch', editor: 'OpenSearch Project', family: 'database', cpe: ['a:amazon:opensearch_security'] },
  { key: 'apache-cassandra', slug: 'apache-cassandra', name: 'Apache Cassandra', editor: 'Apache Software Foundation', family: 'database' },
  { key: 'influxdb', slug: 'influxdb', name: 'InfluxDB', editor: 'InfluxData', family: 'database' },
  { key: 'couchbase-server', slug: 'couchbase-server', name: 'Couchbase Server', editor: 'Couchbase', family: 'database' },
  { key: 'neo4j', slug: 'neo4j', name: 'Neo4j', editor: 'Neo4j', family: 'database' },
  { key: 'clickhouse', slug: 'clickhouse', name: 'ClickHouse', editor: 'ClickHouse', family: 'database', cpe: ['a:clickhouse:clickhouse'] },
  { key: 'memcached', slug: 'memcached', name: 'Memcached', editor: 'Memcached', family: 'database' },
  // Application servers
  { key: 'tomcat', slug: 'tomcat', name: 'Apache Tomcat', editor: 'Apache Software Foundation', family: 'application_server' },
  { key: 'eclipse-jetty', slug: 'eclipse-jetty', name: 'Eclipse Jetty', editor: 'Eclipse Foundation', family: 'application_server', cpe: ['a:mortbay:jetty'] },
  { key: 'redhat-jboss-eap', slug: 'redhat-jboss-eap', name: 'Red Hat JBoss EAP', editor: 'Red Hat', family: 'application_server', cpe: ['a:redhat:jboss_enterprise_application_platform'] },
  // Web servers and proxies
  { key: 'apache-http-server', slug: 'apache-http-server', name: 'Apache HTTP Server', editor: 'Apache Software Foundation', family: 'web_server' },
  // The NVD files the nginx CVE under `f5:nginx` since F5 took it over; `nginx:nginx` keeps two of
  // 2009 and `igor_sysoev:nginx` none, so neither is added.
  { key: 'nginx', slug: 'nginx', name: 'NGINX', editor: 'F5', family: 'web_server' },
  { key: 'haproxy', slug: 'haproxy', name: 'HAProxy', editor: 'HAProxy Technologies', family: 'web_server' },
  { key: 'traefik', slug: 'traefik', name: 'Traefik', editor: 'Traefik Labs', family: 'web_server', cpe: ['a:containous:traefik'] },
  { key: 'caddy', slug: 'caddy', name: 'Caddy', editor: 'Caddy', family: 'web_server', cpe: ['a:caddy_project:caddy'] },
  { key: 'squid', slug: 'squid', name: 'Squid', editor: 'Squid Cache', family: 'web_server' },
  // Hypervisors and virtualisation management
  // ESXi is an operating system for the NVD (`o:vmware:esxi`; `a:vmware:esxi` holds CVE of 2011 at
  // the latest). The versions come from vCenter: both carry the vSphere major (7.0, 8.0, 9.0).
  { key: 'vsphere', slug: 'vcenter', name: 'VMware vSphere', editor: 'Broadcom', family: 'hypervisor', cpe: ['o:vmware:esxi'] },
  { key: 'nutanix-prism', slug: 'nutanix-prism', name: 'Nutanix Prism', editor: 'Nutanix', family: 'hypervisor', noCpe: 'The NVD names no CVE under a Nutanix Prism product.' },
  { key: 'ovirt', slug: 'ovirt', name: 'oVirt', editor: 'oVirt', family: 'hypervisor', cpe: ['a:ovirt:ovirt', 'a:ovirt:ovirt-engine', 'a:redhat:ovirt-engine'] },
  { key: 'citrix-vad', slug: 'citrix-vad', name: 'Citrix Virtual Apps and Desktops', editor: 'Citrix', family: 'hypervisor', cpe: ['a:citrix:virtual_apps_and_desktops'] },
  // Containers
  { key: 'kubernetes', slug: 'kubernetes', name: 'Kubernetes', editor: 'Cloud Native Computing Foundation', family: 'container' },
  { key: 'docker-engine', slug: 'docker-engine', name: 'Docker Engine', editor: 'Docker', family: 'container', cpe: ['a:docker:docker', 'a:mobyproject:moby'] },
  { key: 'containerd', slug: 'containerd', name: 'containerd', editor: 'Cloud Native Computing Foundation', family: 'container' },
  { key: 'podman', slug: 'podman', name: 'Podman', editor: 'Red Hat', family: 'container' },
  { key: 'red-hat-openshift', slug: 'red-hat-openshift', name: 'Red Hat OpenShift', editor: 'Red Hat', family: 'container', cpe: ['a:redhat:openshift_container_platform'] },
  { key: 'rancher', slug: 'rancher', name: 'Rancher', editor: 'SUSE', family: 'container', cpe: ['a:rancher:rancher'] },
  { key: 'harbor', slug: 'harbor', name: 'Harbor', editor: 'Cloud Native Computing Foundation', family: 'container' },
  { key: 'amazon-eks', slug: 'amazon-eks', name: 'Amazon EKS', editor: 'Amazon Web Services', family: 'container', mode: 'subscribed', hosting_type: 'public_cloud', noCpe: 'The NVD names no CVE under an Amazon EKS product.' },
  { key: 'azure-kubernetes-service', slug: 'azure-kubernetes-service', name: 'Azure Kubernetes Service', editor: 'Microsoft', family: 'container', mode: 'subscribed', hosting_type: 'public_cloud', noCpe: 'An online service its provider patches: its CVE call for no action from the customer.' },
  { key: 'google-kubernetes-engine', slug: 'google-kubernetes-engine', name: 'Google Kubernetes Engine', editor: 'Google', family: 'container', mode: 'subscribed', hosting_type: 'public_cloud', noCpe: 'An online service its provider patches: its CVE call for no action from the customer.' },
  // Directory and identity
  { key: 'active-directory', slug: null, name: 'Active Directory', editor: 'Microsoft', family: 'directory', noCpe: 'Its CVE are filed under Windows Server, an operating system (lot T3); a:microsoft:active_directory holds three CVE, the last of 2022.' },
  { key: 'entra-id', slug: null, name: 'Microsoft Entra ID', editor: 'Microsoft', family: 'directory', mode: 'subscribed', noCpe: 'An online service its provider patches: its CVE call for no action from the customer.' },
  { key: 'keycloak', slug: 'keycloak', name: 'Keycloak', editor: 'Red Hat', family: 'directory' },
  { key: 'samba', slug: 'samba', name: 'Samba', editor: 'Samba Team', family: 'directory', cpe: ['a:samba:samba'] },
  { key: 'authentik', slug: 'authentik', name: 'authentik', editor: 'Authentik Security', family: 'directory' },
  // Messaging
  { key: 'msexchange', slug: 'msexchange', name: 'Microsoft Exchange Server', editor: 'Microsoft', family: 'messaging', cpe: ['a:microsoft:exchange_server_subscription_edition'], cpeVersions: [[/^subscription edition\b/i, '15.2']] },
  { key: 'rabbitmq', slug: 'rabbitmq', name: 'RabbitMQ', editor: 'Broadcom', family: 'messaging', cpe: ['a:broadcom:rabbitmq_server'] },
  { key: 'apache-kafka', slug: 'apache-kafka', name: 'Apache Kafka', editor: 'Apache Software Foundation', family: 'messaging' },
  { key: 'apache-activemq', slug: 'apache-activemq', name: 'Apache ActiveMQ', editor: 'Apache Software Foundation', family: 'messaging' },
  { key: 'apache-artemis', slug: 'apache-artemis', name: 'Apache ActiveMQ Artemis', editor: 'Apache Software Foundation', family: 'messaging', cpe: ['a:apache:artemis'] },
  { key: 'ibm-mq', slug: 'ibm-mq', name: 'IBM MQ', editor: 'IBM', family: 'messaging', cpe: ['a:ibm:websphere_mq'] },
  { key: 'postfix', slug: 'postfix', name: 'Postfix', editor: 'Postfix', family: 'messaging' },
  { key: 'dovecot', slug: 'dovecot', name: 'Dovecot', editor: 'Open-Xchange', family: 'messaging', cpe: ['a:open-xchange:dovecot'] },
  // Integration
  { key: 'mulesoft-runtime', slug: 'mulesoft-runtime', name: 'MuleSoft Mule runtime', editor: 'Salesforce', family: 'integration', cpe: ['a:mulesoft:mule_runtime', 'a:salesforce:mule'] },
  { key: 'apache-nifi', slug: 'apache-nifi', name: 'Apache NiFi', editor: 'Apache Software Foundation', family: 'integration' },
  { key: 'kong-gateway', slug: 'kong-gateway', name: 'Kong Gateway', editor: 'Kong', family: 'integration' },
  { key: 'apache-apisix', slug: 'apache-apisix', name: 'Apache APISIX', editor: 'Apache Software Foundation', family: 'integration' },
  // Backup
  { key: 'veeam-backup-and-replication', slug: 'veeam-backup-and-replication', name: 'Veeam Backup & Replication', editor: 'Veeam', family: 'backup', cpe: ['a:veeam:veeam_backup_\\&_replication'] },
  { key: 'veeam-backup-for-microsoft-365', slug: 'veeam-backup-for-microsoft-365', name: 'Veeam Backup for Microsoft 365', editor: 'Veeam', family: 'backup', noCpe: 'The NVD names no CVE under a Veeam Backup for Microsoft 365 product.' },
  { key: 'commvault', slug: 'commvault', name: 'Commvault', editor: 'Commvault', family: 'backup' },
  { key: 'proxmox-backup-server', slug: 'proxmox-backup-server', name: 'Proxmox Backup Server', editor: 'Proxmox', family: 'backup', cpe: ['a:proxmox:backup_server'] },
  // Monitoring
  { key: 'zabbix', slug: 'zabbix', name: 'Zabbix', editor: 'Zabbix', family: 'monitoring', cpe: ['a:zabbix:zabbix_server'] },
  { key: 'grafana', slug: 'grafana', name: 'Grafana', editor: 'Grafana Labs', family: 'monitoring' },
  { key: 'prometheus', slug: 'prometheus', name: 'Prometheus', editor: 'Cloud Native Computing Foundation', family: 'monitoring' },
  { key: 'checkmk', slug: 'checkmk', name: 'Checkmk', editor: 'Checkmk', family: 'monitoring', cpe: ['a:checkmk:checkmk', 'a:tribe29:checkmk'] },
  { key: 'centreon', slug: 'centreon', name: 'Centreon', editor: 'Centreon', family: 'monitoring', cpe: ['a:centreon:centreon_web', 'a:merethis:centreon'] },
  { key: 'icinga', slug: 'icinga', name: 'Icinga', editor: 'Icinga', family: 'monitoring' },
  { key: 'splunk', slug: 'splunk', name: 'Splunk Enterprise', editor: 'Splunk', family: 'monitoring' },
  { key: 'graylog', slug: 'graylog', name: 'Graylog', editor: 'Graylog', family: 'monitoring' },
  { key: 'veeam-one', slug: 'veeam-one', name: 'Veeam ONE', editor: 'Veeam', family: 'monitoring', cpe: ['a:veeam:one'] },
  // Runtimes and frameworks
  { key: 'dotnet', slug: 'dotnet', name: '.NET', editor: 'Microsoft', family: 'runtime', cpe: ['a:microsoft:.net_core'] },
  { key: 'dotnetfx', slug: 'dotnetfx', name: '.NET Framework', editor: 'Microsoft', family: 'runtime', cpe: ['a:microsoft:.net_framework'] },
  { key: 'nodejs', slug: 'nodejs', name: 'Node.js', editor: 'OpenJS Foundation', family: 'runtime' },
  { key: 'python', slug: 'python', name: 'Python', editor: 'Python Software Foundation', family: 'runtime' },
  { key: 'php', slug: 'php', name: 'PHP', editor: 'The PHP Group', family: 'runtime' },
  { key: 'oracle-jdk', slug: 'oracle-jdk', name: 'Oracle JDK', editor: 'Oracle', family: 'runtime' },
  { key: 'eclipse-temurin', slug: 'eclipse-temurin', name: 'Eclipse Temurin', editor: 'Eclipse Foundation', family: 'runtime', cpe: OPENJDK_CPE },
  { key: 'amazon-corretto', slug: 'amazon-corretto', name: 'Amazon Corretto', editor: 'Amazon Web Services', family: 'runtime', cpe: OPENJDK_CPE },
  { key: 'microsoft-build-of-openjdk', slug: 'microsoft-build-of-openjdk', name: 'Microsoft Build of OpenJDK', editor: 'Microsoft', family: 'runtime', cpe: OPENJDK_CPE },
  { key: 'go', slug: 'go', name: 'Go', editor: 'Google', family: 'runtime' },
  { key: 'ruby', slug: 'ruby', name: 'Ruby', editor: 'Ruby', family: 'runtime' },
  { key: 'powershell', slug: 'powershell', name: 'PowerShell', editor: 'Microsoft', family: 'runtime', cpe: ['a:microsoft:powershell_core'] },
  // Storage
  { key: 'ceph', slug: 'ceph', name: 'Ceph', editor: 'Ceph Foundation', family: 'storage', cpe: ['a:ceph:ceph', 'a:linuxfoundation:ceph', 'a:redhat:ceph'] },
  { key: 'nutanix-files', slug: 'nutanix-files', name: 'Nutanix Files', editor: 'Nutanix', family: 'storage', noCpe: 'The NVD names no CVE under a Nutanix Files product.' },
  // Network and security
  { key: 'hashicorp-vault', slug: 'hashicorp-vault', name: 'HashiCorp Vault', editor: 'HashiCorp', family: 'network_security' },
  { key: 'bind-9', slug: 'bind-9', name: 'BIND 9', editor: 'ISC', family: 'network_security', cpe: ['a:isc:bind'] },
  { key: 'opnsense', slug: 'opnsense', name: 'OPNsense', editor: 'Deciso', family: 'network_security' },
  // Administration
  { key: 'ansible-automation-platform', slug: 'red-hat-ansible-automation-platform', name: 'Red Hat Ansible Automation Platform', editor: 'Red Hat', family: 'administration' },
  { key: 'puppet', slug: 'puppet', name: 'Puppet', editor: 'Perforce', family: 'administration', cpe: ['a:puppetlabs:puppet'] },
  { key: 'redhat-satellite', slug: 'redhat-satellite', name: 'Red Hat Satellite', editor: 'Red Hat', family: 'administration', cpe: ['a:redhat:satellite'] },
  { key: 'jenkins', slug: 'jenkins', name: 'Jenkins', editor: 'Jenkins', family: 'administration', cpe: ['a:cloudbees:jenkins'] },
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

/**
 * The CPE identifiers of an entry: the ones endoflife.date publishes (`published`), plus the `cpe`
 * of PRODUCTS, minus its `cpeExclude`, in lower case and sorted; none for an entry with `noCpe`.
 */
function cpeProductsOf(entry, published) {
  if (entry?.noCpe) return [];
  const exclude = new Set((entry?.cpeExclude ?? []).map((id) => id.toLowerCase()));
  const cpe = new Set();
  for (const id of [...published, ...(entry?.cpe ?? [])]) {
    const product = String(id).toLowerCase();
    if (!exclude.has(product)) cpe.add(product);
  }
  return [...cpe].sort();
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
 * - `cpeVersions` of an entry: `[pattern, version]` pairs for the labels without a number the NVD
 *   uses; Exchange `Subscription Edition SU11` → `15.2`, its build line, which the NVD bounds under
 *   `exchange_server_subscription_edition` (`< 15.02.2562.017`);
 * - Oracle Database (`cpeVersion: 'label'`): the NVD names the releases `database_server:19c`,
 *   `21c` in its exact criteria and ranges them in numbers (`19.3` to `19.22`); the label in lower
 *   case matches both, `19c` being 19 with a qualifier.
 */
function cpeVersionOf(label, entry) {
  const text = String(label ?? '').trim();
  if (entry?.cpeVersion === 'label') return text.toLowerCase() || null;
  for (const [pattern, version] of entry?.cpeVersions ?? []) if (pattern.test(text)) return version;
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
 * `--refresh-cpe-versions`: the existing file with `cpe_version` recomputed, the `cpe` of PRODUCTS
 * added to `cpe_products` and its `cpeExclude` removed (the endoflife.date identifiers already in
 * the file are kept otherwise), the `hosting_type` of PRODUCTS copied, nothing fetched.
 */
/** The product with `hosting_type` set from its PRODUCTS entry (or removed), right after `mode`. */
function withHostingType(product, entry) {
  const { hosting_type: _previous, ...rest } = product;
  const out = {};
  for (const [name, value] of Object.entries(rest)) {
    out[name] = value;
    if (name === 'mode' && entry?.hosting_type) out.hosting_type = entry.hosting_type;
  }
  return out;
}

function refreshCpeVersions(out) {
  const catalog = JSON.parse(readFileSync(out, 'utf8'));
  let changed = 0;
  let added = 0;
  let removed = 0;
  catalog.products = catalog.products.map((product) => withHostingType(product, PRODUCTS.find((p) => p.key === product.key)));
  for (const product of catalog.products) {
    const entry = PRODUCTS.find((p) => p.key === product.key);
    const cpe = cpeProductsOf(entry, product.cpe_products);
    added += cpe.filter((id) => !product.cpe_products.includes(id)).length;
    removed += product.cpe_products.filter((id) => !cpe.includes(id)).length;
    product.cpe_products = cpe;
    for (const version of product.versions) {
      const next = cpeVersionOf(version.label, entry);
      if (next !== version.cpe_version) changed += 1;
      version.cpe_version = next;
    }
  }
  writeFileSync(out, `${JSON.stringify(catalog, null, 2)}\n`);
  process.stderr.write(`${changed} CPE versions changed, ${added} CPE products added, ${removed} removed in ${out}\n`);
}

const NVD = 'https://services.nvd.nist.gov/rest/json';
/** Without an API key the NVD allows 5 requests in a rolling 30 seconds: one every 6.5 s. */
const NVD_SPACING_MS = 6500;
/** `part:vendor:product`; the NVD escapes punctuation with a backslash (`veeam_backup_\&_replication`). */
const CPE_PRODUCT_SHAPE = /^[aoh]:(?:[a-z0-9._\-~%!]|\\[^a-z0-9\s])+:(?:[a-z0-9._\-~%!]|\\[^a-z0-9\s])+$/;
let lastNvdCall = 0;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** One GET on the NVD API at the allowed rate; 403, 429, 5xx and network errors retried twice. */
async function nvdGet(path, params) {
  const url = new URL(`${NVD}/${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  for (let attempt = 1; ; attempt += 1) {
    const wait = lastNvdCall + NVD_SPACING_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastNvdCall = Date.now();
    let status = 0;
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(120_000) });
      status = response.status;
      if (response.ok) return await response.json();
    } catch (error) {
      if (attempt >= 3) throw error;
    }
    if (status && ![403, 408, 429].includes(status) && status < 500) throw new Error(`${url}: HTTP ${status}`);
    if (attempt >= 3) throw new Error(`${url}: HTTP ${status}`);
    await sleep(30_000 * attempt);
  }
}

/** `a:vendor:product` → the counts the NVD gives: CPE names of the dictionary, CVE naming it. */
async function nvdCheck(product, latest) {
  const match = `cpe:2.3:${product}`;
  const names = await nvdGet('cpes/2.0', { cpeMatchString: match, resultsPerPage: 1 });
  const cves = await nvdGet('cves/2.0', { virtualMatchString: match, noRejected: '', resultsPerPage: 1 });
  const result = { product, cpe_names: names.totalResults, cves: cves.totalResults };
  if (latest && cves.totalResults > 0) {
    // The CVE API answers in publication order: the last index is the newest CVE.
    const last = await nvdGet('cves/2.0', { virtualMatchString: match, noRejected: '', resultsPerPage: 1, startIndex: cves.totalResults - 1 });
    const cve = last.vulnerabilities?.[0]?.cve;
    result.latest_cve = cve ? `${cve.id} ${String(cve.published).slice(0, 10)}` : null;
  }
  return result;
}

/**
 * `--check-cpe`: every entry of the file has well-formed identifiers or a `noCpe` reason, and
 * matches PRODUCTS (no `cpeExclude` left, every `cpe` present). With --nvd, each identifier is
 * looked up in the NVD; one found neither in the CPE dictionary nor in a CVE is reported, and so is
 * an entry none of whose identifiers names a CVE. Exit code 1 on any finding.
 */
async function checkCpe(out) {
  const catalog = JSON.parse(readFileSync(out, 'utf8'));
  const only = argValue('--only')?.split(',').map((key) => key.trim()).filter(Boolean);
  const nvd = process.argv.includes('--nvd');
  const latest = process.argv.includes('--latest');
  const findings = [];
  const report = [];
  const descriptions = JSON.parse(readFileSync(DESCRIPTIONS, 'utf8')).descriptions;
  for (const key of Object.keys(descriptions)) {
    if (!catalog.products.some((product) => product.key === key)) findings.push(`${key}: description of an entry the catalog does not have`);
  }
  for (const product of catalog.products) {
    if (only && !only.includes(product.key)) continue;
    const entry = PRODUCTS.find((p) => p.key === product.key);
    if (!entry) findings.push(`${product.key}: not in PRODUCTS`);
    for (const id of product.cpe_products) {
      if (!CPE_PRODUCT_SHAPE.test(id)) findings.push(`${product.key}: malformed identifier ${id}`);
    }
    const expected = cpeProductsOf(entry, product.cpe_products);
    if (expected.join() !== product.cpe_products.join()) {
      findings.push(`${product.key}: file differs from PRODUCTS (${product.cpe_products.join(' ')} → ${expected.join(' ')}), run --refresh-cpe-versions`);
    }
    if (!product.cpe_products.length && !entry?.noCpe) findings.push(`${product.key}: no CPE identifier and no noCpe reason`);
    if (product.cpe_products.length && entry?.noCpe) findings.push(`${product.key}: noCpe set but identifiers present`);
    for (const language of ['en', 'fr', 'de', 'es']) {
      if (!descriptions[product.key]?.[language]?.trim()) findings.push(`${product.key}: no ${language} description in ${DESCRIPTIONS}`);
    }
    if (!nvd) continue;
    let cves = 0;
    for (const id of product.cpe_products) {
      const result = { key: product.key, ...(await nvdCheck(id, latest)) };
      report.push(result);
      cves += result.cves;
      process.stderr.write(`${product.key.padEnd(32)} ${id.padEnd(48)} ${String(result.cpe_names).padStart(6)} CPE ${String(result.cves).padStart(6)} CVE ${result.latest_cve ?? ''}\n`);
      // A name of the dictionary without CVE yet is kept (Temurin, Corretto); one the NVD uses
      // nowhere is a mistake.
      if (!result.cpe_names && !result.cves) findings.push(`${product.key}: ${id} is neither in the CPE dictionary nor in a CVE`);
    }
    if (product.cpe_products.length && !cves) findings.push(`${product.key}: no identifier names a CVE`);
  }
  const reportFile = argValue('--report');
  if (reportFile) writeFileSync(resolve(reportFile), `${JSON.stringify(report, null, 2)}\n`);
  for (const finding of findings) process.stderr.write(`FINDING ${finding}\n`);
  process.stderr.write(`${findings.length} finding(s)${nvd ? `, ${report.length} identifiers looked up in the NVD` : ''}\n`);
  if (findings.length) process.exitCode = 1;
}

/** `--nvd-count <ids>`: `nvdCheck` on identifiers given by hand, one line each (tab-separated). */
async function nvdCount(list) {
  const latest = process.argv.includes('--latest');
  for (const id of list.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)) {
    if (!CPE_PRODUCT_SHAPE.test(id)) {
      process.stdout.write(`${id}\tmalformed\n`);
      continue;
    }
    const result = await nvdCheck(id, latest);
    process.stdout.write(`${id}\t${result.cpe_names} CPE\t${result.cves} CVE\t${result.latest_cve ?? ''}\n`);
  }
}

/**
 * `--nvd-search <keywords | pattern>`: the identifiers whose CPE titles hold every keyword, or
 * that match a CPE pattern (`cpe:2.3:` then components, `*` for any), by number of CPE names.
 */
async function nvdSearch(keywords) {
  const query = keywords.startsWith('cpe:2.3:') ? { cpeMatchString: keywords } : { keywordSearch: keywords };
  const counts = new Map();
  let startIndex = 0;
  let total = 0;
  do {
    const page = await nvdGet('cpes/2.0', { ...query, resultsPerPage: 10000, startIndex });
    total = page.totalResults;
    for (const { cpe } of page.products ?? []) {
      const product = cpeProduct(cpe.cpeName);
      if (!product) continue;
      const row = counts.get(product) ?? { names: 0, title: cpe.titles?.find((t) => t.lang === 'en')?.title ?? '' };
      row.names += 1;
      counts.set(product, row);
    }
    startIndex += page.resultsPerPage || 10000;
  } while (startIndex < total && startIndex < 50000);
  const rows = [...counts.entries()].sort((a, b) => b[1].names - a[1].names || a[0].localeCompare(b[0]));
  for (const [product, row] of rows) process.stdout.write(`${String(row.names).padStart(6)}  ${product.padEnd(56)} ${row.title}\n`);
  process.stderr.write(`${total} CPE names for "${keywords}", ${rows.length} identifiers\n`);
}

async function main() {
  const out = resolve(argValue('--out') ?? DEFAULT_OUT);
  if (process.argv.includes('--refresh-cpe-versions')) return refreshCpeVersions(out);
  if (process.argv.includes('--check-cpe')) return checkCpe(out);
  if (process.argv.includes('--nvd-count')) return nvdCount(argValue('--nvd-count') ?? '');
  if (process.argv.includes('--nvd-search')) return nvdSearch(argValue('--nvd-search') ?? '');
  const today = argValue('--today') ?? new Date().toISOString().slice(0, 10);
  const products = [];
  for (const entry of PRODUCTS) {
    const remote = entry.slug ? await fetchProduct(entry.slug) : null;
    const published = [];
    for (const identifier of remote?.identifiers ?? []) {
      if (identifier.type !== 'cpe') continue;
      const product = cpeProduct(identifier.id);
      if (product) published.push(product);
    }
    const cpe = cpeProductsOf(entry, published);
    products.push({
      key: entry.key,
      name: entry.name,
      editor: entry.editor,
      family: entry.family,
      mode: entry.mode ?? 'installed',
      ...(entry.hosting_type ? { hosting_type: entry.hosting_type } : {}),
      cpe_products: cpe,
      source_url: entry.slug ? `https://endoflife.date/${entry.slug}` : null,
      versions: remote ? versionsOf(remote.releases ?? [], today, entry) : [],
    });
    process.stderr.write(`${entry.key}: ${products.at(-1).versions.length} versions, ${cpe.length} CPE\n`);
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
