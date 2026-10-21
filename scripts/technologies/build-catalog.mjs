#!/usr/bin/env node
// Builds backend/src/technologies/catalog/technologies.catalog.json, the starting catalog of
// technologies KANAP ships (plan planning/cartographie-technologies.md, lot S): common products by
// family, with their editor, CPE product identifiers, major versions and end-of-support dates.
//
// Source: the open API of endoflife.date (https://endoflife.date/docs/api/v1/), whose data is
// published under the MIT license (Copyright 2020 endoflife.date contributors; the notice is in
// backend/src/technologies/catalog/LICENSE-endoflife-date.txt). The products kept are listed below
// (PRODUCTS). A product endoflife.date does not cover is maintained by KANAP: one file per product
// in backend/src/technologies/catalog/curated/ (`slug: null, curated: true`, the key is the file
// name). Each version keeps the support dates read from the vendor, the page they came from and
// the day they were checked. Those files are KANAP data. A product with `slug` null and no curated
// file is written from this list only, with no versions.
// Operating systems are in this catalog since lot T3. Their version labels are rewritten
// (`versionLabel`) so they match the former IT settings catalog (`2012 R2`, `22.04 LTS`,
// `12 (Bookworm)`, `15 SP5`). endoflife.date names a SUSE service pack `15.5`: the label stored
// is `15 SP5`, which is what the shipped operating-system codes resolve to. Amazon Linux keeps
// `2` and `2023` and drops the `AMI` prefix (`AMI 2018.03` → `2018.03`). AIX technology levels
// collapse to the release an administrator writes (`7.3 TL4` → `7.3`). IBM i and Alpine already
// use those labels (`7.5`, `3.22`). Solaris 11.4 does too; the first Solaris 11 release is named
// `11`, stored `11.0`, so that one-segment label does not cover 11.4. An operating system
// keeps every release whose support ended in 2010 or later (`OS_SUPPORT_ENDED_SINCE`), however
// many; `keepRelease` leaves out the cycles an IT department does not run (the Windows Server
// semi-annual and annual channels, the Ubuntu interim releases). The living catalog
// (catalog-releases.ts) applies the same rules (`OS_RELEASE_RULES` there).
// `security_tracker` is the page where the distributor tracks vulnerabilities of an operating
// system. It is copied into the shipped file. Windows Server, CentOS, AIX, IBM i and Solaris
// have none: their CVE are published under product identifiers, or the distributor no longer
// has a tracker page. Nothing in the application reads the field yet.
//
// Usage: node scripts/technologies/build-catalog.mjs [--out <file>] [--today YYYY-MM-DD]
//        node scripts/technologies/build-catalog.mjs --refresh-cpe-versions [--out <file>]
//        (recomputes `cpe_version` in the existing file with `cpeVersionOf`, adds the `cpe`
//        identifiers of PRODUCTS to `cpe_products`, copies their `cve_names` and their
//        `hosting_type`, without the network)
//        node scripts/technologies/build-catalog.mjs --check-cpe [--nvd [--only k1,k2] [--latest]
//                                                     [--report <file>]]
//        (checks the CPE identifiers of the file against PRODUCTS: syntax, and an entry without
//        any must say why in `noCpe`; checks `cve_names` the same way a technology does (shape,
//        lengths, duplicates) and that the file carries the names of PRODUCTS; that each
//        entry has its four descriptions in technologies.descriptions.json; and that each file in
//        curated/ matches a `curated: true` product (required fields, ISO dates, date order,
//        unique labels, checked_on, no_planned_end); offline by default.
//        With --nvd, asks the CPE dictionary of the NVD whether each `part:vendor:product` exists
//        and how many CVE name it, --latest
//        adds the newest CVE. Set NVD_API_KEY to send it as the `apiKey` header: one request every
//        0.7 s with the key, every 6.5 s without. The key is never logged.)
//        node scripts/technologies/build-catalog.mjs --nvd-count <a:vendor:product,...> [--latest]
//        (the same NVD counts for identifiers not in the catalog yet, before adding them)
//        node scripts/technologies/build-catalog.mjs --nvd-search <keywords | cpe:2.3:...>
//        (the `part:vendor:product` identifiers of the CPE dictionary whose titles hold these
//        words, or that match a CPE pattern such as `cpe:2.3:*:*:nginx` (any part and vendor),
//        with their number of CPE names: how a missing identifier or a second name is found)
// Reproducible: the same answers from the API give the same file (sorted keys, no timestamp
// besides `source.retrieved_on`, the day passed with --today or the current day).

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
 * Operating systems (family `operating_system`) in place of the two rules above: every version
 * whose last support (standard, extended or end of life) ends on this day or later, however many.
 * Servers run old systems long after their support ended (Windows Server 2003, SLES 11), and
 * KANAP must name them to flag them. Twin of `OS_SUPPORT_ENDED_SINCE` in catalog-releases.ts.
 */
const OS_SUPPORT_ENDED_SINCE = '2010-01-01';

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
 * ones endoflife.date publishes (`part:vendor:product`).
 * `cve_names`: optional names the publisher writes in CVE.org, copied onto an adopted technology
 * and kept by the sync the same way as `cpe`. Each item is `{ vendor, product, version? }`: the
 * vendor and the product as published (1 to 200 characters), and a version of at most 50
 * characters when the name carries one. The texts are stored as the publisher writes them.
 * `curated: true` with `slug: null`: the versions come from
 * `backend/src/technologies/catalog/curated/<key>.json`, in the file's order. The product
 * `source_url` is the file's `lifecycle_url`, and `source_updated` is copied as published (null
 * when the page states none). A version keeps `source_url`, `checked_on` and `no_planned_end`.
 * `note`, `source_terms`, `aliases` and `date_precision` stay in the source file. `build_prefixes`
 * receives a numeric alias only (`7.3` on the label `7.3 LTS`): the same role as a release name
 * that differs from its label, a build an observed version can start with.
 * `mode`: `subscribed` for a service.
 * `hosting_type`: a code of the default hosting types (`on_prem`, `colocation`, `public_cloud`,
 * `private_cloud`, `saas`) when `mode` says too little (a managed cloud service is `public_cloud`,
 * where `subscribed` alone gives `saas`); the adoption writes it in place of the one of `mode`.
 * `cpeVersion`: `label` (the label, lower case, is the NVD version), `escaped-parens`
 * (`9.16(4)` → `9.16\(4\)`) or `strip-x` (`4.36.x` → `4.36`). `cpeVersions`: `[pattern, version]`
 * for labels without a usable number (see `cpeVersionOf`).
 * `cpeExclude`: identifiers published by endoflife.date that the NVD does not use for this product.
 * `noCpe`: why an entry has no identifier (checked by --check-cpe); it drops any published one. Every identifier kept was
 * checked against the NVD with --check-cpe --nvd (lot C3, 2026-10-17; the operating systems, lot V3,
 * 2026-10-20; the entries still without one, lot V5, 2026-10-20): CVE name it. A name the dictionary
 * does not list yet is kept when CVE use it (`a:microsoft:entra_provisioning_service`).
 * `versionLabel(release)`: the label stored, when cleanLabel would not match the names KANAP
 * already shows. `keepRelease(release)`: false for a release cycle the catalog leaves out.
 * Both are twins of `OS_RELEASE_RULES` in catalog-releases.ts.
 * `security_tracker`: the distributor's vulnerability page for an operating system, copied into
 * the shipped file. Absent when the entry has none.
 */
// SLES: the NVD files the major in the version and the service pack in the update component
// (`linux_enterprise_server:15:sp5`), under five names over the years (SUSE, then Novell and the
// openSUSE project for SLES 10 to 12). `o:suse:suse_linux` and `o:novell:suse_linux` are left out:
// they also name the former SUSE Linux desktop releases (9.0, 10.1), which would meet SLES 10 and 11. The matching compares the major and, when a criterion names
// a service pack, that service pack (`SERVICE_PACK_PRODUCTS` in vulnerability-rules.ts).
// `o:suse:sles`, the identifier endoflife.date publishes, names no CVE.
const SLES_CPE = ['o:suse:linux_enterprise_server', 'o:suse:suse_linux_enterprise_server', 'o:novell:suse_linux_enterprise_server', 'o:opensuse_project:suse_linux_enterprise_server', 'o:opensuse:suse_linux_enterprise_server'];

/**
 * "Windows Server 2019 (LTSC)" → "2019"; "Windows Server 2012 R2 (LTSC)" → "2012 R2"; the service
 * pack goes: "Windows Server 2008 R2 SP1 (LTSC)" → "2008 R2", "Windows Server 2003 SP2" → "2003"
 * (the newest service pack comes first and takes the label; the older ones share it and are left out).
 */
function windowsServerLabel(release) {
  const cleaned = cleanLabel(release.label, release.name);
  return cleaned.replace(/^Windows Server\s+/i, '').replace(/\s+SP\d+$/i, '') || cleaned;
}

/** The long-term releases only: the semi-annual (`1809-sac`) and annual (`23h2-ac`) channels are left out. */
function windowsServerRelease(release) {
  return !/-(sac|ac)$/i.test(String(release.name));
}

/** The LTS releases only: endoflife.date marks them `isLts`. */
function ubuntuRelease(release) {
  return release.isLts === true;
}

/** "22.04 'Jammy Jellyfish' (LTS)" → "22.04 LTS". */
function ubuntuLabel(release) {
  return `${release.name} LTS`;
}

/** "12 (Bookworm)" stays, parentheses included: cleanLabel would leave "12". */
function debianLabel(release) {
  const raw = String(release.label ?? '').replace(/\s+/g, ' ').trim();
  return raw || String(release.name);
}

/** endoflife.date names a service pack "15.5": "15 SP5", "11.4" → "11 SP4"; "15.0" → "15", "12.0" → "12". */
function slesLabel(release) {
  const match = /^(\d+)\.(\d+)$/.exec(String(release.name));
  if (match) return match[2] === '0' ? match[1] : `${match[1]} SP${Number(match[2])}`;
  return cleanLabel(release.label, release.name);
}

/** "2" and "2023" stay. "AMI 2018.03" → "2018.03". */
function amazonLinuxLabel(release) {
  return cleanLabel(release.label, release.name).replace(/^AMI\s+/i, '');
}

/** "7.3 TL4" (name `7.3.4`) → "7.3". The version key is that label, so the next technology level updates it. */
function aixLabel(release) {
  const match = /^(\d+\.\d+)\.\d+$/.exec(String(release.name));
  if (match) return match[1];
  return cleanLabel(release.label, release.name);
}

/**
 * "11.4" stays. The first Solaris 11 release is named "11": a one-segment label would cover every
 * 11.x criterion, including 11.4. Stored "11.0".
 */
function solarisLabel(release) {
  const cleaned = cleanLabel(release.label, release.name);
  return cleaned === '11' ? '11.0' : cleaned;
}

const PRODUCTS = [
  // Operating systems (lot T3). CPE identifiers checked at the NVD (lot V3). Windows Server is one
  // product per long-term release from 2003 (the build is not `cpe_version`: the year rule matches the
  // release). The others keep the version `cpeVersionOf` already derives. SLES: see SLES_CPE.
  // RHEL, Debian, Oracle Linux, AlmaLinux, Rocky Linux, CentOS and SLES are matched on the major, Ubuntu
  // on YY.MM, AIX, IBM i and Solaris on the two-segment branch (`VERSION_PRECISION` in
  // vulnerability-rules.ts, `matchSegments` in catalog-releases.ts): a version typed 9.4, 22.04.3 LTS,
  // 7.3.2 or 11.4.2 still meets the branch the NVD publishes (9.0, 22.04, 7.3.0, 11.4).
  // Rocky Linux: endoflife.date publishes `o:rocky:rocky`, which the NVD does not use.
  // October 2026: RHEL 4 to 7 also come as the Server, Workstation and Desktop editions (about 1 900 CVE
  // each); the support channels (EUS, AUS, TUS, ELS, RHUI, supplementary) are left out. Windows Server
  // also comes as `o:microsoft:windows_server` with the release as version (`2022`, 302 CVE).
  // RHEL 8 and 9 AppStream CVE carry only `a:redhat:enterprise_linux`. The matching compares that
  // form on the major, as it does for `o:` (`VERSION_PRECISION`).
  { key: 'windows-server', slug: 'windows-server', name: 'Windows Server', editor: 'Microsoft', family: 'operating_system', cpe: ['o:microsoft:windows_server_2003', 'o:microsoft:windows_server_2008', 'o:microsoft:windows_server_2012', 'o:microsoft:windows_server_2016', 'o:microsoft:windows_server_2019', 'o:microsoft:windows_server_2022', 'o:microsoft:windows_server_2025', 'o:microsoft:windows_server'], versionLabel: windowsServerLabel, keepRelease: windowsServerRelease },
  { key: 'ubuntu', slug: 'ubuntu', name: 'Ubuntu', editor: 'Canonical', family: 'operating_system', cpe: ['o:canonical:ubuntu_linux'], security_tracker: 'https://ubuntu.com/security/cves', versionLabel: ubuntuLabel, keepRelease: ubuntuRelease },
  { key: 'rhel', slug: 'rhel', name: 'Red Hat Enterprise Linux', editor: 'Red Hat', family: 'operating_system', cpe: ['a:redhat:enterprise_linux', 'o:redhat:enterprise_linux', 'o:redhat:enterprise_linux_desktop', 'o:redhat:enterprise_linux_server', 'o:redhat:enterprise_linux_workstation'], security_tracker: 'https://access.redhat.com/security/security-updates/cve' },
  { key: 'debian', slug: 'debian', name: 'Debian', editor: 'Debian', family: 'operating_system', cpe: ['o:debian:debian_linux'], security_tracker: 'https://security-tracker.debian.org/tracker/', versionLabel: debianLabel },
  { key: 'sles', slug: 'sles', name: 'SUSE Linux Enterprise Server', editor: 'SUSE', family: 'operating_system', cpe: SLES_CPE, cpeExclude: ['o:suse:sles'], security_tracker: 'https://www.suse.com/security/cve/', versionLabel: slesLabel },
  { key: 'rocky-linux', slug: 'rocky-linux', name: 'Rocky Linux', editor: 'Rocky Enterprise Software Foundation', family: 'operating_system', cpe: ['o:resf:rocky_linux'], cpeExclude: ['o:rocky:rocky'], security_tracker: 'https://errata.rockylinux.org/' },
  { key: 'almalinux', slug: 'almalinux', name: 'AlmaLinux', editor: 'AlmaLinux OS Foundation', family: 'operating_system', cpe: ['o:almalinux:almalinux'], security_tracker: 'https://errata.almalinux.org/' },
  { key: 'oracle-linux', slug: 'oracle-linux', name: 'Oracle Linux', editor: 'Oracle', family: 'operating_system', cpe: ['o:oracle:linux'], security_tracker: 'https://linux.oracle.com/security/' },
  // CentOS has no vendor vulnerability page left (centos.org/security is gone).
  { key: 'centos', slug: 'centos', name: 'CentOS', editor: 'The CentOS Project', family: 'operating_system', cpe: ['o:centos:centos'] },
  // endoflife.date, October 2026. Amazon Linux: endoflife.date also publishes `o:amazon:linux`, which names no CVE.
  // Solaris 10 stays in the catalog (extended support through 2027), so the Sun identifier is kept with it.
  { key: 'amazon-linux', slug: 'amazon-linux', name: 'Amazon Linux', editor: 'Amazon Web Services', family: 'operating_system', cpe: ['o:amazon:amazon_linux'], cpeExclude: ['o:amazon:linux'], security_tracker: 'https://alas.aws.amazon.com/', versionLabel: amazonLinuxLabel },
  { key: 'alpine-linux', slug: 'alpine-linux', name: 'Alpine Linux', editor: 'Alpine', family: 'operating_system', cpe: ['o:alpinelinux:alpine_linux'], security_tracker: 'https://security.alpinelinux.org/' },
  // AIX, IBM i and Solaris publish their CVE under the product identifiers. No distributor tracker page.
  { key: 'ibm-aix', slug: 'ibm-aix', name: 'IBM AIX', editor: 'IBM', family: 'operating_system', cpe: ['o:ibm:aix'], versionLabel: aixLabel },
  { key: 'ibm-i', slug: 'ibm-i', name: 'IBM i', editor: 'IBM', family: 'operating_system', cpe: ['o:ibm:i', 'a:ibm:i'] },
  { key: 'oracle-solaris', slug: 'oracle-solaris', name: 'Oracle Solaris', editor: 'Oracle', family: 'operating_system', cpe: ['o:oracle:solaris', 'a:oracle:solaris', 'o:sun:solaris'], versionLabel: solarisLabel },
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
  // Managed services: `subscribed` alone would be SaaS. They run in the public cloud.
  // RDS for MariaDB and Aurora MySQL each name one CVE (CVE-2026-3494). Kept.
  { key: 'amazon-rds-postgresql', slug: 'amazon-rds-postgresql', name: 'Amazon RDS for PostgreSQL', editor: 'AWS', family: 'database', mode: 'subscribed', hosting_type: 'public_cloud', noCpe: 'Verified on 2026-10-20: the NVD names no CVE under an Amazon RDS for PostgreSQL product. a:amazon:relational_database_service holds one CVE, CVE-2026-3494, with a MariaDB version (10.11.15) and no PostgreSQL entry.' },
  { key: 'amazon-rds-mysql', slug: 'amazon-rds-mysql', name: 'Amazon RDS for MySQL', editor: 'AWS', family: 'database', mode: 'subscribed', hosting_type: 'public_cloud', noCpe: 'Verified on 2026-10-20: the NVD names no CVE under an Amazon RDS for MySQL product. a:amazon:relational_database_service is the RDS for MariaDB entry (CVE-2026-3494, MariaDB 10.11.15).' },
  { key: 'amazon-rds-mariadb', slug: 'amazon-rds-mariadb', name: 'Amazon RDS for MariaDB', editor: 'AWS', family: 'database', mode: 'subscribed', hosting_type: 'public_cloud', cpe: ['a:amazon:relational_database_service'] },
  { key: 'amazon-aurora-postgresql', slug: 'amazon-aurora-postgresql', name: 'Amazon Aurora PostgreSQL', editor: 'AWS', family: 'database', mode: 'subscribed', hosting_type: 'public_cloud', noCpe: 'Verified on 2026-10-20: the NVD names no CVE under an Amazon Aurora PostgreSQL product. a:amazon:aurora_postgresql does not exist.' },
  { key: 'amazon-aurora-mysql', slug: 'amazon-aurora-mysql', name: 'Amazon Aurora MySQL', editor: 'AWS', family: 'database', mode: 'subscribed', hosting_type: 'public_cloud', cpe: ['a:amazon:aurora_mysql'] },
  { key: 'azure-database-for-postgresql', slug: 'azure-database-for-postgresql', name: 'Azure Database for PostgreSQL', editor: 'Microsoft', family: 'database', mode: 'subscribed', hosting_type: 'public_cloud', cpe: ['a:microsoft:azure_database_for_postgresql_flexible_server'] },
  { key: 'azure-database-for-mysql', slug: 'azure-database-for-mysql', name: 'Azure Database for MySQL', editor: 'Microsoft', family: 'database', mode: 'subscribed', hosting_type: 'public_cloud', noCpe: 'Verified on 2026-10-20: the NVD names no CVE under an Azure Database for MySQL product. a:microsoft:azure_database_for_mysql and a:microsoft:azure_database_for_mysql_flexible_server do not exist.' },
  { key: 'amazon-elasticache-redis', slug: 'amazon-elasticache-redis', name: 'Amazon ElastiCache (Redis OSS / Valkey)', editor: 'AWS', family: 'database', mode: 'subscribed', hosting_type: 'public_cloud', noCpe: 'Verified on 2026-10-20: the NVD names no CVE under an Amazon ElastiCache product. a:amazon:elasticache does not exist.' },
  { key: 'amazon-documentdb', slug: 'amazon-documentdb', name: 'Amazon DocumentDB', editor: 'AWS', family: 'database', mode: 'subscribed', hosting_type: 'public_cloud', noCpe: 'Verified on 2026-10-20: the NVD names no CVE under an Amazon DocumentDB product. a:amazon:documentdb does not exist; the only dictionary entry is a:amazon:documentdb_mcp_server, a client tool.' },
  { key: 'amazon-opensearch', slug: 'amazon-opensearch', name: 'Amazon OpenSearch Service', editor: 'AWS', family: 'database', mode: 'subscribed', hosting_type: 'public_cloud', noCpe: 'Verified on 2026-10-20: the NVD names no CVE under an Amazon OpenSearch Service product. a:amazon:opensearch_service does not exist, and a:amazon:opensearch (11 CVE) is the family of OpenSearch client libraries.' },
  { key: 'apache-spark', slug: 'apache-spark', name: 'Apache Spark', editor: 'ASF', family: 'database', cpe: ['a:apache:spark'] },
  { key: 'solr', slug: 'solr', name: 'Apache Solr', editor: 'ASF', family: 'database', cpe: ['a:apache:solr'] },
  // Application servers
  { key: 'tomcat', slug: 'tomcat', name: 'Apache Tomcat', editor: 'Apache Software Foundation', family: 'application_server' },
  { key: 'eclipse-jetty', slug: 'eclipse-jetty', name: 'Eclipse Jetty', editor: 'Eclipse Foundation', family: 'application_server', cpe: ['a:mortbay:jetty'] },
  { key: 'redhat-jboss-eap', slug: 'redhat-jboss-eap', name: 'Red Hat JBoss EAP', editor: 'Red Hat', family: 'application_server', cpe: ['a:redhat:jboss_enterprise_application_platform'] },
  { key: 'wordpress', slug: 'wordpress', name: 'WordPress', editor: 'WordPress', family: 'application_server', cpe: ['a:wordpress:wordpress'] },
  { key: 'drupal', slug: 'drupal', name: 'Drupal', editor: 'Drupal', family: 'application_server', cpe: ['a:drupal:drupal'] },
  // Web servers and proxies
  { key: 'apache-http-server', slug: 'apache-http-server', name: 'Apache HTTP Server', editor: 'Apache Software Foundation', family: 'web_server' },
  // The NVD files the nginx CVE under `f5:nginx` since F5 took it over; `nginx:nginx` keeps two of
  // 2009 and `igor_sysoev:nginx` none, so neither is added.
  { key: 'nginx', slug: 'nginx', name: 'NGINX', editor: 'F5', family: 'web_server' },
  { key: 'haproxy', slug: 'haproxy', name: 'HAProxy', editor: 'HAProxy Technologies', family: 'web_server' },
  { key: 'traefik', slug: 'traefik', name: 'Traefik', editor: 'Traefik Labs', family: 'web_server', cpe: ['a:containous:traefik'] },
  { key: 'caddy', slug: 'caddy', name: 'Caddy', editor: 'Caddy', family: 'web_server', cpe: ['a:caddy_project:caddy'] },
  { key: 'squid', slug: 'squid', name: 'Squid', editor: 'Squid Cache', family: 'web_server' },
  { key: 'envoy', slug: 'envoy', name: 'Envoy', editor: 'CNCF', family: 'web_server', cpe: ['a:envoyproxy:envoy'] },
  // Hypervisors and virtualisation management
  // ESXi is an operating system for the NVD (`o:vmware:esxi`; `a:vmware:esxi` holds CVE of 2011 at
  // the latest). The versions come from vCenter: both carry the vSphere major (7.0, 8.0, 9.0).
  { key: 'vsphere', slug: 'vcenter', name: 'VMware vSphere', editor: 'Broadcom', family: 'hypervisor', cpe: ['o:vmware:esxi'] },
  { key: 'nutanix-prism', slug: 'nutanix-prism', name: 'Nutanix Prism', editor: 'Nutanix', family: 'hypervisor', noCpe: 'Verified on 2026-10-20: a:nutanix:prism is in the CPE dictionary and names no CVE. CVE-2026-84731 (Prism Element) has no CPE criterion.' },
  { key: 'ovirt', slug: 'ovirt', name: 'oVirt', editor: 'oVirt', family: 'hypervisor', cpe: ['a:ovirt:ovirt', 'a:ovirt:ovirt-engine', 'a:redhat:ovirt-engine'] },
  { key: 'citrix-vad', slug: 'citrix-vad', name: 'Citrix Virtual Apps and Desktops', editor: 'Citrix', family: 'hypervisor', cpe: ['a:citrix:virtual_apps_and_desktops'] },
  { key: 'proxmox-ve', slug: 'proxmox-ve', name: 'Proxmox VE', editor: 'Proxmox', family: 'hypervisor', cpe: ['a:proxmox:virtual_environment'] },
  { key: 'xcp-ng', slug: 'xcp-ng', name: 'XCP-ng', editor: 'Vates', family: 'hypervisor', noCpe: 'Verified on 2026-10-20: the NVD has no XCP-ng product (a:vates:xcp-ng, o:vates:xcp-ng and a:xcp-ng:xcp-ng do not exist). a:xen:xen names 7 CVE, the newest CVE-2014-5148, and does not follow the XCP-ng versions.' },
  { key: 'nutanix-aos', slug: 'nutanix-aos', name: 'Nutanix AOS', editor: 'Nutanix', family: 'hypervisor', noCpe: 'Verified on 2026-10-20: o:nutanix:aos is in the CPE dictionary (one name, no version) and names no CVE. a:nutanix:aos does not exist. o:nutanix:ahv names 16 CVE, the newest CVE-2021-1087 (2021-04-29), and is the hypervisor, not AOS.' },
  // Horizon 8 is a calendar version at endoflife.date (`8.2606`). The NVD stops at 7.13 (CVE-2022-22964): the identifiers are kept, and those 8.x versions do not meet the old numbers.
  { key: 'horizon', slug: 'horizon', name: 'Omnissa Horizon', editor: 'Omnissa', family: 'hypervisor', cpe: ['a:vmware:horizon', 'a:vmware:horizon_view'] },
  { key: 'vmware-cloud-foundation', slug: 'vmware-cloud-foundation', name: 'VMware Cloud Foundation', editor: 'Broadcom', family: 'hypervisor', cpe: ['a:vmware:cloud_foundation', 'o:vmware:cloud_foundation'] },
  // Containers
  { key: 'kubernetes', slug: 'kubernetes', name: 'Kubernetes', editor: 'Cloud Native Computing Foundation', family: 'container' },
  { key: 'docker-engine', slug: 'docker-engine', name: 'Docker Engine', editor: 'Docker', family: 'container', cpe: ['a:docker:docker', 'a:mobyproject:moby'] },
  { key: 'containerd', slug: 'containerd', name: 'containerd', editor: 'Cloud Native Computing Foundation', family: 'container' },
  { key: 'podman', slug: 'podman', name: 'Podman', editor: 'Red Hat', family: 'container' },
  { key: 'red-hat-openshift', slug: 'red-hat-openshift', name: 'Red Hat OpenShift', editor: 'Red Hat', family: 'container', cpe: ['a:redhat:openshift_container_platform', 'o:redhat:openshift'] },
  { key: 'rancher', slug: 'rancher', name: 'Rancher', editor: 'SUSE', family: 'container', cpe: ['a:rancher:rancher'] },
  { key: 'harbor', slug: 'harbor', name: 'Harbor', editor: 'Cloud Native Computing Foundation', family: 'container' },
  { key: 'istio', slug: 'istio', name: 'Istio', editor: 'CNCF', family: 'container', cpe: ['a:istio:istio'] },
  { key: 'amazon-eks', slug: 'amazon-eks', name: 'Amazon EKS', editor: 'Amazon Web Services', family: 'container', mode: 'subscribed', hosting_type: 'public_cloud', noCpe: 'Verified on 2026-10-20: the NVD names no CVE under an Amazon EKS product. a:amazon:eks and a:amazon:elastic_kubernetes_service do not exist, and CVE-2026-86831 (the EKS Network Policy Agent) has no CPE criterion.' },
  // 11 CVE on 2026-10-20, the newest CVE-2026-50516. The version is `-` (the whole service), except two platform dates.
  { key: 'azure-kubernetes-service', slug: 'azure-kubernetes-service', name: 'Azure Kubernetes Service', editor: 'Microsoft', family: 'container', mode: 'subscribed', hosting_type: 'public_cloud', cpe: ['a:microsoft:azure_kubernetes_service'] },
  { key: 'google-kubernetes-engine', slug: 'google-kubernetes-engine', name: 'Google Kubernetes Engine', editor: 'Google', family: 'container', mode: 'subscribed', hosting_type: 'public_cloud', noCpe: 'Verified on 2026-10-20: a:google:kubernetes_engine holds CVE-2019-5736 (runc, every version) and CVE-2019-10365 (the Jenkins plugin, up to 0.6.2). a:google:gke does not exist.' },
  // Directory and identity
  { key: 'active-directory', slug: null, name: 'Active Directory', editor: 'Microsoft', family: 'directory', noCpe: 'Verified on 2026-10-20: its CVE are filed under Windows Server, which carries its identifiers. a:microsoft:active_directory names one vulnerable criterion, CVE-2013-1282; the two 2022 matches are an IBM plug-in. a:microsoft:active_directory_domain_services does not exist.' },
  // entra_id (14 CVE, CVE-2026-83941), the former azure_active_directory (6 CVE, CVE-2026-50481) and the
  // provisioning service (2 CVE, CVE-2026-59115). The version is `-`.
  { key: 'entra-id', slug: null, name: 'Microsoft Entra ID', editor: 'Microsoft', family: 'directory', mode: 'subscribed', cpe: ['a:microsoft:azure_active_directory', 'a:microsoft:entra_id', 'a:microsoft:entra_provisioning_service'] },
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
  { key: 'amazon-msk', slug: 'amazon-msk', name: 'Amazon MSK', editor: 'AWS', family: 'messaging', mode: 'subscribed', hosting_type: 'public_cloud', noCpe: 'Verified on 2026-10-20: the NVD names no CVE under an Amazon MSK product. a:amazon:msk and a:amazon:managed_streaming_for_apache_kafka do not exist.' },
  { key: 'exim', slug: 'exim', name: 'Exim', editor: 'Exim', family: 'messaging', cpe: ['a:exim:exim'] },
  { key: 'proxmox-mail-gateway', slug: 'proxmox-mail-gateway', name: 'Proxmox Mail Gateway', editor: 'Proxmox', family: 'messaging', cpe: ['a:proxmox:proxmox_mail_gateway'] },
  // Integration
  { key: 'mulesoft-runtime', slug: 'mulesoft-runtime', name: 'MuleSoft Mule runtime', editor: 'Salesforce', family: 'integration', cpe: ['a:mulesoft:mule_runtime', 'a:salesforce:mule'] },
  { key: 'apache-nifi', slug: 'apache-nifi', name: 'Apache NiFi', editor: 'Apache Software Foundation', family: 'integration' },
  { key: 'kong-gateway', slug: 'kong-gateway', name: 'Kong Gateway', editor: 'Kong', family: 'integration' },
  { key: 'apache-apisix', slug: 'apache-apisix', name: 'Apache APISIX', editor: 'Apache Software Foundation', family: 'integration' },
  { key: 'apache-airflow', slug: 'apache-airflow', name: 'Apache Airflow', editor: 'ASF', family: 'integration', cpe: ['a:apache:airflow'] },
  { key: 'zookeeper', slug: 'zookeeper', name: 'Apache ZooKeeper', editor: 'ASF', family: 'integration', cpe: ['a:apache:zookeeper'] },
  // Backup
  { key: 'veeam-backup-and-replication', slug: 'veeam-backup-and-replication', name: 'Veeam Backup & Replication', editor: 'Veeam', family: 'backup', cpe: ['a:veeam:veeam_backup_\\&_replication'] },
  { key: 'veeam-backup-for-microsoft-365', slug: 'veeam-backup-for-microsoft-365', name: 'Veeam Backup for Microsoft 365', editor: 'Veeam', family: 'backup', noCpe: 'Verified on 2026-10-20: the NVD names no CVE under a Veeam Backup for Microsoft 365 product. a:veeam:backup_for_microsoft_365 and a:veeam:backup_for_microsoft_office_365 do not exist.' },
  { key: 'commvault', slug: 'commvault', name: 'Commvault', editor: 'Commvault', family: 'backup' },
  { key: 'proxmox-backup-server', slug: 'proxmox-backup-server', name: 'Proxmox Backup Server', editor: 'Proxmox', family: 'backup', cpe: ['a:proxmox:backup_server'] },
  { key: 'vmware-srm', slug: 'vmware-srm', name: 'VMware Live Site Recovery', editor: 'Broadcom', family: 'backup', noCpe: 'Verified on 2026-10-20: the NVD names no CVE under a VMware Site Recovery Manager product. a:vmware:site_recovery_manager and a:vmware:srm do not exist, and no keyword search of the CPE dictionary finds the product.' },
  { key: 'zerto', slug: 'zerto', name: 'Zerto', editor: 'HPE', family: 'backup', noCpe: 'Verified on 2026-10-20: the NVD names no CVE under a Zerto product. a:zerto:zerto_virtual_manager and a:hpe:zerto do not exist, and the CPE dictionary holds no Zerto entry.' },
  // No public lifecycle table (October 2026). The user types the versions.
  { key: 'rubrik-cdm', slug: null, name: 'Rubrik CDM', editor: 'Rubrik', family: 'backup', cpe: ['a:rubrik:cdm', 'a:rubrik:cloud_data_management'] },
  { key: 'cohesity-dataprotect', slug: null, name: 'Cohesity DataProtect', editor: 'Cohesity', family: 'backup', cpe: ['a:cohesity:cohesity_dataplatform', 'a:cohesity:dataplatform'] },
  // Monitoring
  { key: 'zabbix', slug: 'zabbix', name: 'Zabbix', editor: 'Zabbix', family: 'monitoring', cpe: ['a:zabbix:zabbix_server'] },
  { key: 'grafana', slug: 'grafana', name: 'Grafana', editor: 'Grafana Labs', family: 'monitoring' },
  { key: 'prometheus', slug: 'prometheus', name: 'Prometheus', editor: 'Cloud Native Computing Foundation', family: 'monitoring' },
  { key: 'checkmk', slug: 'checkmk', name: 'Checkmk', editor: 'Checkmk', family: 'monitoring', cpe: ['a:checkmk:checkmk', 'a:tribe29:checkmk'] },
  { key: 'centreon', slug: 'centreon', name: 'Centreon', editor: 'Centreon', family: 'monitoring', cpe: ['a:centreon:centreon_web', 'a:merethis:centreon'] },
  { key: 'icinga', slug: 'icinga', name: 'Icinga', editor: 'Icinga', family: 'monitoring' },
  { key: 'splunk', slug: 'splunk', name: 'Splunk Enterprise', editor: 'Splunk', family: 'monitoring' },
  { key: 'graylog', slug: 'graylog', name: 'Graylog', editor: 'Graylog', family: 'monitoring' },
  { key: 'veeam-one', slug: 'veeam-one', name: 'Veeam ONE', editor: 'Veeam', family: 'monitoring', cpe: ['a:veeam:one', 'h:veeam:one'] },
  { key: 'kibana', slug: 'kibana', name: 'Kibana', editor: 'Elastic', family: 'monitoring', cpe: ['a:elastic:kibana'] },
  { key: 'logstash', slug: 'logstash', name: 'Logstash', editor: 'Elastic', family: 'monitoring', cpe: ['a:elastic:logstash'] },
  { key: 'grafana-loki', slug: 'grafana-loki', name: 'Grafana Loki', editor: 'Grafana Labs', family: 'monitoring', cpe: ['a:grafana:loki'] },
  // No public lifecycle table (October 2026). The user types the versions.
  { key: 'prtg', slug: null, name: 'PRTG Network Monitor', editor: 'Paessler', family: 'monitoring', cpe: ['a:paessler:prtg_network_monitor'] },
  // Runtimes and frameworks
  { key: 'dotnet', slug: 'dotnet', name: '.NET', editor: 'Microsoft', family: 'runtime', cpe: ['a:microsoft:.net_core'] },
  { key: 'dotnetfx', slug: 'dotnetfx', name: '.NET Framework', editor: 'Microsoft', family: 'runtime', cpe: ['a:microsoft:.net_framework'] },
  { key: 'nodejs', slug: 'nodejs', name: 'Node.js', editor: 'OpenJS Foundation', family: 'runtime', cpe: ['a:joyent:node.js'] },
  { key: 'python', slug: 'python', name: 'Python', editor: 'Python Software Foundation', family: 'runtime' },
  { key: 'php', slug: 'php', name: 'PHP', editor: 'The PHP Group', family: 'runtime' },
  // October 2026: older spellings the NVD still files CVE under (Sun JDK and JRE: 395 and 426 CVE;
  // Joyent Node.js 2; OpenShift 2 as an operating system 8; Satellite 3; Veeam ONE as hardware 2).
  { key: 'oracle-jdk', slug: 'oracle-jdk', name: 'Oracle JDK', editor: 'Oracle', family: 'runtime', cpe: ['a:sun:jdk', 'a:sun:jre'] },
  { key: 'eclipse-temurin', slug: 'eclipse-temurin', name: 'Eclipse Temurin', editor: 'Eclipse Foundation', family: 'runtime', cpe: OPENJDK_CPE },
  { key: 'amazon-corretto', slug: 'amazon-corretto', name: 'Amazon Corretto', editor: 'Amazon Web Services', family: 'runtime', cpe: OPENJDK_CPE },
  { key: 'microsoft-build-of-openjdk', slug: 'microsoft-build-of-openjdk', name: 'Microsoft Build of OpenJDK', editor: 'Microsoft', family: 'runtime', cpe: OPENJDK_CPE },
  // The OpenJDK builds follow Temurin: Oracle's identifiers, plus the vendor's own name when the NVD has one.
  { key: 'azul-zulu', slug: 'azul-zulu', name: 'Azul Zulu', editor: 'Azul', family: 'runtime', cpe: ['a:azul:zulu', ...OPENJDK_CPE] },
  { key: 'bellsoft-liberica', slug: 'bellsoft-liberica', name: 'BellSoft Liberica JDK', editor: 'BellSoft', family: 'runtime', cpe: OPENJDK_CPE },
  { key: 'ibm-semeru-runtime', slug: 'ibm-semeru-runtime', name: 'IBM Semeru Runtime', editor: 'IBM', family: 'runtime', cpe: ['a:ibm:semeru_runtime', ...OPENJDK_CPE] },
  // Red Hat files its own build under these two identifiers, besides the Oracle ones the other builds share.
  { key: 'redhat-build-of-openjdk', slug: 'redhat-build-of-openjdk', name: 'Red Hat build of OpenJDK', editor: 'Red Hat', family: 'runtime', cpe: ['a:redhat:openjdk', 'a:redhat:openjdk_els', ...OPENJDK_CPE] },
  { key: 'spring-boot', slug: 'spring-boot', name: 'Spring Boot', editor: 'Broadcom', family: 'runtime', cpe: ['a:vmware:spring_boot'] },
  // Three successive publisher names. The Pivotal and SpringSource ones cover the versions up to 5.x.
  { key: 'spring-framework', slug: 'spring-framework', name: 'Spring Framework', editor: 'Broadcom', family: 'runtime', cpe: ['a:vmware:spring_framework', 'a:pivotal_software:spring_framework', 'a:springsource:spring_framework'] },
  { key: 'log4j', slug: 'log4j', name: 'Apache Log4j', editor: 'ASF', family: 'runtime', cpe: ['a:apache:log4j'] },
  { key: 'apache-struts', slug: 'apache-struts', name: 'Apache Struts', editor: 'ASF', family: 'runtime', cpe: ['a:apache:struts'] },
  { key: 'go', slug: 'go', name: 'Go', editor: 'Google', family: 'runtime' },
  { key: 'ruby', slug: 'ruby', name: 'Ruby', editor: 'Ruby', family: 'runtime' },
  { key: 'powershell', slug: 'powershell', name: 'PowerShell', editor: 'Microsoft', family: 'runtime', cpe: ['a:microsoft:powershell_core'] },
  // Storage
  { key: 'ceph', slug: 'ceph', name: 'Ceph', editor: 'Ceph Foundation', family: 'storage', cpe: ['a:ceph:ceph', 'a:linuxfoundation:ceph', 'a:redhat:ceph'] },
  { key: 'nutanix-files', slug: 'nutanix-files', name: 'Nutanix Files', editor: 'Nutanix', family: 'storage', noCpe: 'Verified on 2026-10-20: a:nutanix:files_storage is in the CPE dictionary and names no CVE. a:nutanix:files does not exist.' },
  { key: 'netapp-ontap', slug: 'netapp-ontap', name: 'NetApp ONTAP', editor: 'NetApp', family: 'storage', cpe: ['a:netapp:ontap', 'a:netapp:clustered_data_ontap', 'o:netapp:clustered_data_ontap'] },
  // The NVD only names TrueNAS CORE up to 13.0 (`truenas_firmware`, 3 CVE, newest CVE-2024-11946). The catalog follows 24.x and 25.x. Kept: the identifier names CVE.
  { key: 'truenas', slug: 'truenas', name: 'TrueNAS', editor: 'iXsystems', family: 'storage', cpe: ['o:ixsystems:truenas_firmware'] },
  // No public lifecycle table (October 2026). The user types the versions. The Purity identifier keeps the escaped slash the NVD writes.
  { key: 'pure-purity-fa', slug: null, name: 'Pure Storage Purity//FA', editor: 'Pure Storage', family: 'storage', cpe: ['a:purestorage:purity\\/\\/fa', 'a:purestorage:purity'] },
  { key: 'hpe-alletra-nimble', slug: null, name: 'HPE Alletra 5000/6000 (NimbleOS)', editor: 'HPE', family: 'storage', cpe: ['o:hpe:nimbleos'] },
  // Network and security
  { key: 'hashicorp-vault', slug: 'hashicorp-vault', name: 'HashiCorp Vault', editor: 'HashiCorp', family: 'network_security' },
  { key: 'bind-9', slug: 'bind-9', name: 'BIND 9', editor: 'ISC', family: 'network_security', cpe: ['a:isc:bind'] },
  { key: 'opnsense', slug: 'opnsense', name: 'OPNsense', editor: 'Deciso', family: 'network_security' },
  { key: 'panos', slug: 'panos', name: 'Palo Alto PAN-OS', editor: 'Palo Alto Networks', family: 'network_security', cpe: ['o:paloaltonetworks:pan-os'] },
  { key: 'fortios', slug: 'fortios', name: 'FortiOS', editor: 'Fortinet', family: 'network_security', cpe: ['o:fortinet:fortios'] },
  { key: 'pangp', slug: 'pangp', name: 'Palo Alto GlobalProtect', editor: 'Palo Alto Networks', family: 'network_security', cpe: ['a:paloaltonetworks:globalprotect'] },
  { key: 'sns-firmware', slug: 'sns-firmware', name: 'Stormshield Network Security', editor: 'Stormshield', family: 'network_security', cpe: ['a:stormshield:stormshield_network_security', 'a:stormshield:network_security'] },
  // The community-edition label `7.9.103-ce` is the NVD version `7.9.103`. `traps` is the name before Cortex XDR.
  { key: 'cortex-xdr', slug: 'cortex-xdr', name: 'Cortex XDR agent', editor: 'Palo Alto Networks', family: 'network_security', cpe: ['a:paloaltonetworks:cortex_xdr_agent', 'a:paloaltonetworks:traps'], cpeVersions: [[/^7\.9\.103-ce$/i, '7.9.103']] },
  // BIG-IP keeps the modules that share one TMOS version: LTM, APM, ASM, Advanced WAF, AFM and DNS (`big-ip_dns` is the older DNS name, 14 CVE).
  { key: 'cisco-ios-xe', slug: 'cisco-ios-xe', name: 'Cisco IOS XE', editor: 'Cisco', family: 'network', cpe: ['o:cisco:ios_xe', 'a:cisco:ios_xe'] },
  { key: 'routeros', slug: 'routeros', name: 'MikroTik RouterOS', editor: 'MikroTik', family: 'network', cpe: ['o:mikrotik:routeros'] },
  { key: 'big-ip', slug: 'big-ip', name: 'F5 BIG-IP', editor: 'F5', family: 'network', cpe: ['a:f5:big-ip_local_traffic_manager', 'a:f5:big-ip_access_policy_manager', 'a:f5:big-ip_application_security_manager', 'a:f5:big-ip_advanced_web_application_firewall', 'a:f5:big-ip_advanced_firewall_manager', 'a:f5:big-ip_domain_name_system', 'a:f5:big-ip_dns'] },
  // No public lifecycle table (October 2026). The user types the versions.
  { key: 'aruba-aos-cx', slug: null, name: 'HPE Aruba Networking AOS-CX', editor: 'HPE', family: 'network', cpe: ['o:hpe:arubaos-cx'] },
  // Administration
  { key: 'ansible-automation-platform', slug: 'red-hat-ansible-automation-platform', name: 'Red Hat Ansible Automation Platform', editor: 'Red Hat', family: 'administration' },
  { key: 'puppet', slug: 'puppet', name: 'Puppet', editor: 'Perforce', family: 'administration', cpe: ['a:puppetlabs:puppet'] },
  { key: 'redhat-satellite', slug: 'redhat-satellite', name: 'Red Hat Satellite', editor: 'Red Hat', family: 'administration', cpe: ['a:redhat:satellite', 'o:redhat:satellite'] },
  { key: 'jenkins', slug: 'jenkins', name: 'Jenkins', editor: 'Jenkins', family: 'administration', cpe: ['a:cloudbees:jenkins'] },
  { key: 'gitlab', slug: 'gitlab', name: 'GitLab', editor: 'GitLab', family: 'administration', cpe: ['a:gitlab:gitlab'] },
  { key: 'jira-software', slug: 'jira-software', name: 'Jira Software', editor: 'Atlassian', family: 'administration', cpe: ['a:atlassian:jira', 'a:atlassian:jira_server', 'a:atlassian:jira_data_center', 'a:atlassian:jira_software_data_center'] },
  { key: 'jira-service-management', slug: 'jira-service-management', name: 'Jira Service Management', editor: 'Atlassian', family: 'administration', cpe: ['a:atlassian:jira_service_desk', 'a:atlassian:jira_service_management'] },
  { key: 'confluence', slug: 'confluence', name: 'Confluence', editor: 'Atlassian', family: 'administration', cpe: ['a:atlassian:confluence', 'a:atlassian:confluence_server', 'a:atlassian:confluence_data_center'] },
  { key: 'bitbucket', slug: 'bitbucket', name: 'Bitbucket', editor: 'Atlassian', family: 'administration', cpe: ['a:atlassian:bitbucket', 'a:atlassian:bitbucket_server', 'a:atlassian:bitbucket_data_center'] },
  // The NVD also files the Jenkins plug-in under `a:jfrog:artifactory`. Kept: the identifier names the product's CVE.
  { key: 'artifactory', slug: 'artifactory', name: 'JFrog Artifactory', editor: 'JFrog', family: 'administration', cpe: ['a:jfrog:artifactory'] },
  { key: 'nexus', slug: 'nexus', name: 'Sonatype Nexus Repository', editor: 'Sonatype', family: 'administration', cpe: ['a:sonatype:nexus_repository_manager'] },
  // SonarQube Server: the NVD stops at 10.x (10.6, CVE-2024-47911). The catalog follows the calendar versions (`2026.5`). The identifier is kept; those versions do not meet the old numbers.
  { key: 'sonarqube-server', slug: 'sonarqube-server', name: 'SonarQube Server', editor: 'SonarSource', family: 'administration', cpe: ['a:sonarsource:sonarqube'] },
  { key: 'terraform', slug: 'terraform', name: 'Terraform', editor: 'HashiCorp (IBM)', family: 'administration', cpe: ['a:hashicorp:terraform'] },
  { key: 'consul', slug: 'consul', name: 'HashiCorp Consul', editor: 'HashiCorp (IBM)', family: 'administration', cpe: ['a:hashicorp:consul'] },
  { key: 'chef-infra-server', slug: 'chef-infra-server', name: 'Chef Infra Server', editor: 'Progress', family: 'administration', cpe: ['a:progress:chef_infra_server'] },
  { key: 'salt', slug: 'salt', name: 'Salt', editor: 'Broadcom', family: 'administration', cpe: ['a:saltstack:salt'] },
  // ansible-core 2.12 to 2.21 does not match the NVD numbering: `ansible_engine` stops at 3.5, `ansible` at 2.10 and earlier.
  { key: 'ansible-core', slug: 'ansible-core', name: 'Ansible (core)', editor: 'Red Hat', family: 'administration', noCpe: 'Verified on 2026-10-20: a:redhat:ansible_engine (up to 3.5) and a:redhat:ansible (2.10 and earlier) do not follow the ansible-core 2.x versions the catalog keeps (2.12 to 2.21). a:redhat:ansible_core does not exist. a:ansible:ansible, which endoflife.date publishes, names one CVE from 2016 and no CPE name.' },
  { key: 'azure-devops-server', slug: 'azure-devops-server', name: 'Azure DevOps Server', editor: 'Microsoft', family: 'administration', cpe: ['o:microsoft:azure_devops_server'] },
  // SharePoint: the NVD still files 2019 and the build numbers `16.0.*` (newest CVE-2026-108452). Subscription Edition is `sharepoint_server` with version `-`, so a version cannot be matched. The identifiers are kept.
  { key: 'sharepoint', slug: 'sharepoint', name: 'SharePoint Server', editor: 'Microsoft', family: 'other', cpe: ['a:microsoft:sharepoint_server', 'a:microsoft:sharepoint_enterprise_server'] },
  // Maintained by KANAP (backend/src/technologies/catalog/curated/). Identifiers checked against
  // the NVD on 2026-10-20 (planning/catalogue-enrichi/cpe.md, group B). `security` in those notes
  // is the family `network_security`. No entry excludes an identifier or goes without one.
  { key: 'check-point-gaia', slug: null, curated: true, name: 'Check Point Gaia (Quantum)', editor: 'Check Point', family: 'network_security', cpe: ['o:checkpoint:gaia_os', 'o:checkpoint:gaia', 'a:checkpoint:quantum_security_management', 'o:checkpoint:quantum_security_gateway_firmware', 'a:checkpoint:security_gateway'], cpeVersion: 'label' },
  { key: 'cisco-asa', slug: null, curated: true, name: 'Cisco Secure Firewall ASA', editor: 'Cisco', family: 'network_security', cpe: ['o:cisco:adaptive_security_appliance_software', 'a:cisco:adaptive_security_appliance_software'], cpeVersion: 'escaped-parens' },
  { key: 'cisco-ftd', slug: null, curated: true, name: 'Cisco Secure Firewall Threat Defense', editor: 'Cisco', family: 'network_security', cpe: ['a:cisco:secure_firewall_threat_defense', 'a:cisco:firepower_threat_defense', 'o:cisco:firepower_threat_defense'] },
  { key: 'sophos-firewall', slug: null, curated: true, name: 'Sophos Firewall (SFOS)', editor: 'Sophos', family: 'network_security', cpe: ['o:sophos:firewall_firmware', 'o:sophos:xg_firewall_firmware', 'o:sophos:sfos', 'a:sophos:firewall'] },
  { key: 'ivanti-connect-secure', slug: null, curated: true, name: 'Ivanti Connect Secure', editor: 'Ivanti', family: 'network_security', cpe: ['a:ivanti:connect_secure', 'a:pulsesecure:pulse_connect_secure'], cpeVersion: 'strip-x', cpeVersions: [[/^9\.1R\d+$/i, '9.1']] },
  { key: 'cisco-nx-os', slug: null, curated: true, name: 'Cisco NX-OS', editor: 'Cisco', family: 'network', cpe: ['o:cisco:nx-os', 'a:cisco:nx-os'], cpeVersion: 'escaped-parens' },
  { key: 'juniper-junos', slug: null, curated: true, name: 'Juniper Junos OS', editor: 'HPE Juniper Networking', family: 'network', cpe: ['o:juniper:junos', 'o:juniper:junos_os_evolved'] },
  { key: 'arista-eos', slug: null, curated: true, name: 'Arista EOS', editor: 'Arista Networks', family: 'network', cpe: ['o:arista:eos'], cpeVersion: 'strip-x' },
  { key: 'netscaler-adc', slug: null, curated: true, name: 'NetScaler ADC', editor: 'Cloud Software Group', family: 'network', cpe: ['a:citrix:netscaler_application_delivery_controller', 'a:citrix:netscaler_gateway', 'o:citrix:netscaler_application_delivery_controller_firmware', 'o:citrix:netscaler_gateway_firmware', 'a:citrix:application_delivery_controller', 'a:citrix:gateway', 'a:citrix:netscaler'] },
  { key: 'dell-powerstore', slug: null, curated: true, name: 'Dell PowerStore OS', editor: 'Dell Technologies', family: 'storage', cpe: ['o:dell:powerstoreos', 'o:dell:emc_powerstore_firmware'] },
  { key: 'dell-powerscale', slug: null, curated: true, name: 'Dell PowerScale OneFS', editor: 'Dell Technologies', family: 'storage', cpe: ['o:dell:powerscale_onefs', 'a:dell:powerscale_onefs', 'o:dell:emc_powerscale_onefs', 'o:emc:isilon_onefs', 'a:dell:emc_isilon_onefs'] },
  { key: 'dell-unity', slug: null, curated: true, name: 'Dell Unity OE', editor: 'Dell Technologies', family: 'storage', cpe: ['a:dell:unity_operating_environment', 'a:dell:emc_unity_operating_environment', 'a:dell:unity_xt_operating_environment', 'a:dell:emc_unity_xt_operating_environment', 'a:dell:unityvsa_operating_environment', 'a:dell:emc_unityvsa_operating_environment'] },
  { key: 'synology-dsm', slug: null, curated: true, name: 'Synology DSM', editor: 'Synology', family: 'storage', cpe: ['o:synology:diskstation_manager', 'a:synology:diskstation_manager'] },
  { key: 'veritas-netbackup', slug: null, curated: true, name: 'NetBackup', editor: 'Cohesity', family: 'backup', cpe: ['a:veritas:netbackup'] },
  { key: 'dell-data-domain', slug: null, curated: true, name: 'Dell PowerProtect DD (DD OS)', editor: 'Dell Technologies', family: 'backup', cpe: ['o:dell:data_domain_operating_system', 'o:dell:emc_data_domain_os', 'o:emc:data_domain_os'] },
  { key: 'oracle-weblogic', slug: null, curated: true, name: 'Oracle WebLogic Server', editor: 'Oracle', family: 'application_server', cpe: ['a:oracle:weblogic_server'], cpeVersion: 'strip-x' },
  { key: 'ibm-websphere', slug: null, curated: true, name: 'IBM WebSphere Application Server', editor: 'IBM', family: 'application_server', cpe: ['a:ibm:websphere_application_server'], cpeVersion: 'strip-x' },
];

/**
 * Names the publishers write in their CVE Records (`affected` vendor and product), by catalog key,
 * copied into `cve_names` of PRODUCTS. Read on the CVE.org records of the last 24 months (October 2026):
 * the pairs that the NVD filed under the entry's CPE identifiers, kept by hand. A name that carries a
 * release has its `version` (`Windows Server 2019` for the versions labelled `2019`). Red Hat entries
 * have none: Red Hat records carry CPE identifiers. Terms: backend/src/technologies/catalog/LICENSE-cve.txt.
 */
const CVE_NAMES = {
  "windows-server": [
    { vendor: "Microsoft", product: "Windows Server 2025", version: "2025" },
    { vendor: "Microsoft", product: "Windows Server 2025 (Server Core installation)", version: "2025" },
    { vendor: "Microsoft", product: "Windows Server 2022", version: "2022" },
    { vendor: "Microsoft", product: "Windows Server 2022, 23H2 Edition (Server Core installation)", version: "2022" },
    { vendor: "Microsoft", product: "Windows Server 2019", version: "2019" },
    { vendor: "Microsoft", product: "Windows Server 2019 (Server Core installation)", version: "2019" },
    { vendor: "Microsoft", product: "Windows Server 2016", version: "2016" },
    { vendor: "Microsoft", product: "Windows Server 2016 (Server Core installation)", version: "2016" },
    { vendor: "Microsoft", product: "Windows Server 2012 R2", version: "2012 R2" },
    { vendor: "Microsoft", product: "Windows Server 2012 R2 (Server Core installation)", version: "2012 R2" },
    { vendor: "Microsoft", product: "Windows Server 2012", version: "2012" },
    { vendor: "Microsoft", product: "Windows Server 2012 (Server Core installation)", version: "2012" },
    { vendor: "Microsoft", product: "Windows Server 2008 R2 Service Pack 1", version: "2008 R2" },
    { vendor: "Microsoft", product: "Windows Server 2008 R2 Service Pack 1 (Server Core installation)", version: "2008 R2" },
    { vendor: "Microsoft", product: "Windows Server 2008 Service Pack 2", version: "2008" },
    { vendor: "Microsoft", product: "Windows Server 2008 Service Pack 2 (Server Core installation)", version: "2008" },
    { vendor: "Microsoft", product: "Windows Server 2008 R2", version: "2008 R2" },
    { vendor: "Microsoft", product: "Windows Server 2008 R2 Systems Service Pack 1", version: "2008 R2" },
    { vendor: "Microsoft", product: "Windows Server 2008", version: "2008" },
  ],
  // Operating systems (October 2026 lot): Canonical and SUSE publish the release in the product name.
  // SLES names keep the major only: the matching compares the major, and a service pack name
  // (`15 SP5`) would hide the names of the whole major from that service pack (the longest
  // release wins).
  ubuntu: [
    { vendor: "Canonical", product: "Ubuntu Linux" },
    { vendor: "Canonical", product: "Ubuntu" },
    { vendor: "Canonical", product: "Ubuntu 26.04 LTS", version: "26.04" },
    { vendor: "Canonical", product: "Ubuntu 24.04 LTS", version: "24.04" },
    { vendor: "Canonical", product: "Ubuntu 22.04 LTS", version: "22.04" },
    { vendor: "Canonical", product: "Ubuntu 20.04 LTS", version: "20.04" },
    { vendor: "Canonical", product: "Ubuntu 18.04 LTS", version: "18.04" },
    { vendor: "Canonical", product: "Ubuntu 16.04 LTS", version: "16.04" },
  ],
  sles: [
    { vendor: "SUSE", product: "SUSE Linux Enterprise Server" },
    { vendor: "SUSE", product: "SUSE Linux Enterprise Server 15", version: "15" },
    { vendor: "SUSE", product: "SUSE Linux Enterprise Server 15-LTSS", version: "15" },
    { vendor: "SUSE", product: "SUSE Linux Enterprise Server 15 SP1", version: "15" },
    { vendor: "SUSE", product: "SUSE Linux Enterprise Server 15 SP4-LTSS", version: "15" },
    { vendor: "SUSE", product: "SUSE Linux Enterprise Server 15 SP5-LTSS", version: "15" },
    { vendor: "SUSE", product: "SUSE Linux Enterprise Server 15 SP6", version: "15" },
    { vendor: "SUSE", product: "SUSE Linux Enterprise Server 15 SP6-LTSS", version: "15" },
    { vendor: "SUSE", product: "SUSE Linux Enterprise Server 15 SP7", version: "15" },
    { vendor: "SUSE", product: "SUSE Linux Enterprise Server 12", version: "12" },
    { vendor: "SUSE", product: "SUSE Linux Enterprise Server 12-SP4", version: "12" },
    { vendor: "SUSE", product: "SUSE Linux Enterprise Server 12-SP5", version: "12" },
    { vendor: "SUSE", product: "SUSE Linux Enterprise Server 11", version: "11" },
    { vendor: "SUSE", product: "SUSE Linux Enterprise Server 11-SP4-LTSS", version: "11" },
  ],
  mssqlserver: [
    { vendor: "Microsoft", product: "Microsoft SQL Server 2025 for x64-based Systems (GDR)", version: "2025" },
    { vendor: "Microsoft", product: "Microsoft SQL Server 2025 (CU8)", version: "2025" },
    { vendor: "Microsoft", product: "Microsoft SQL Server 2022 (GDR)", version: "2022" },
    { vendor: "Microsoft", product: "Microsoft SQL Server 2022 (CU 26)", version: "2022" },
    { vendor: "Microsoft", product: "Microsoft SQL Server 2019 (GDR)", version: "2019" },
    { vendor: "Microsoft", product: "Microsoft SQL Server 2019 (CU 32)", version: "2019" },
    { vendor: "Microsoft", product: "Microsoft SQL Server 2017 (GDR)", version: "2017" },
    { vendor: "Microsoft", product: "Microsoft SQL Server 2017 (CU 31)", version: "2017" },
    { vendor: "Microsoft", product: "Microsoft SQL Server 2016 Service Pack 3 (GDR)", version: "2016" },
    { vendor: "Microsoft", product: "Microsoft SQL Server 2016 Service Pack 3 Azure Connect Feature Pack", version: "2016" },
    { vendor: "Microsoft", product: "Microsoft SQL Server 2019 (CU 29)", version: "2019" },
  ],
  msexchange: [
    { vendor: "Microsoft", product: "Microsoft Exchange Server Subscription Edition RTM", version: "Subscription Edition" },
    { vendor: "Microsoft", product: "Microsoft Exchange Server 2019 Cumulative Update 15", version: "2019 CU15" },
    { vendor: "Microsoft", product: "Microsoft Exchange Server 2019 Cumulative Update 14", version: "2019 CU14" },
    { vendor: "Microsoft", product: "Microsoft Exchange Server 2016 Cumulative Update 23", version: "2016 CU23" },
  ],
  dotnet: [
    { vendor: "Microsoft", product: ".NET 10.0", version: "10" },
    { vendor: "Microsoft", product: ".NET 9.0", version: "9" },
    { vendor: "Microsoft", product: ".NET 8.0", version: "8" },
    { vendor: "Microsoft", product: ".NET 6.0", version: "6" },
    { vendor: "Microsoft", product: ".NET 7.0", version: "7" },
  ],
  powershell: [
    { vendor: "Microsoft", product: "PowerShell 7.6", version: "7.6" },
    { vendor: "Microsoft", product: "PowerShell 7.5", version: "7.5" },
    { vendor: "Microsoft", product: "PowerShell 7.4", version: "7.4" },
    { vendor: "Microsoft", product: "PowerShell Core" },
  ],
  "entra-id": [
    { vendor: "Microsoft", product: "Microsoft Entra" },
    { vendor: "Microsoft", product: "Azure Active Directory" },
  ],
  "azure-kubernetes-service": [
    { vendor: "Microsoft", product: "Azure Kubernetes Service" },
  ],
  jenkins: [
    { vendor: "Jenkins Project", product: "Jenkins" },
  ],
  tomcat: [
    { vendor: "Apache Software Foundation", product: "Apache Tomcat" },
  ],
  "eclipse-jetty": [
    { vendor: "Eclipse Foundation", product: "Eclipse Jetty" },
    { vendor: "Eclipse Foundation", product: "Jetty" },
    { vendor: "The Eclipse Foundation", product: "Eclipse Jetty" },
  ],
  commvault: [
    { vendor: "Commvault", product: "Commvault Cloud" },
  ],
  "veeam-backup-and-replication": [
    { vendor: "Veeam", product: "Backup and Replication" },
    { vendor: "Veeam", product: "Backup & Replication" },
  ],
  containerd: [
    { vendor: "containerd", product: "containerd" },
  ],
  podman: [
    { vendor: "podman-container-tools", product: "podman" },
  ],
  "apache-cassandra": [
    { vendor: "Apache Software Foundation", product: "Apache Cassandra" },
  ],
  elasticsearch: [
    { vendor: "Elastic", product: "Elasticsearch" },
  ],
  "ibm-db2": [
    { vendor: "IBM", product: "Db2" },
    { vendor: "IBM", product: "Db2 for Linux, UNIX and Windows" },
  ],
  memcached: [
    { vendor: "memcached", product: "memcached" },
  ],
  mongodb: [
    { vendor: "MongoDB", product: "MongoDB Server" },
    { vendor: "MongoDB Inc", product: "MongoDB Server" },
  ],
  postgresql: [
    { vendor: "n/a", product: "PostgreSQL" },
  ],
  redis: [
    { vendor: "redis", product: "redis" },
  ],
  valkey: [
    { vendor: "valkey-io", product: "valkey" },
  ],
  authentik: [
    { vendor: "goauthentik", product: "authentik" },
  ],
  "apache-apisix": [
    { vendor: "Apache Software Foundation", product: "Apache APISIX" },
  ],
  "apache-nifi": [
    { vendor: "Apache Software Foundation", product: "Apache NiFi" },
  ],
  "apache-activemq": [
    { vendor: "Apache Software Foundation", product: "Apache ActiveMQ" },
    { vendor: "Apache Software Foundation", product: "Apache ActiveMQ All" },
    { vendor: "Apache Software Foundation", product: "Apache ActiveMQ Broker" },
  ],
  "apache-artemis": [
    { vendor: "Apache Software Foundation", product: "Apache ActiveMQ Artemis" },
    { vendor: "Apache Software Foundation", product: "Apache Artemis" },
  ],
  "apache-kafka": [
    { vendor: "Apache Software Foundation", product: "Apache Kafka" },
  ],
  dovecot: [
    { vendor: "Open-Xchange GmbH", product: "OX Dovecot Pro" },
  ],
  rabbitmq: [
    { vendor: "rabbitmq", product: "rabbitmq-server" },
  ],
  checkmk: [
    { vendor: "Checkmk GmbH", product: "Checkmk" },
  ],
  grafana: [
    { vendor: "Grafana", product: "Grafana OSS" },
    { vendor: "Grafana", product: "Grafana" },
    { vendor: "Grafana", product: "Grafana Enterprise" },
  ],
  prometheus: [
    { vendor: "prometheus", product: "prometheus" },
  ],
  splunk: [
    { vendor: "Splunk", product: "Splunk Enterprise" },
  ],
  zabbix: [
    { vendor: "Zabbix", product: "Zabbix" },
  ],
  "bind-9": [
    { vendor: "ISC", product: "BIND 9" },
  ],
  "hashicorp-vault": [
    { vendor: "HashiCorp", product: "Vault" },
    { vendor: "HashiCorp", product: "Vault Enterprise" },
  ],
  "oracle-linux": [
    { vendor: "Oracle Corporation", product: "Oracle Linux" },
  ],
  nodejs: [
    { vendor: "nodejs", product: "node" },
  ],
  php: [
    { vendor: "PHP Group", product: "PHP" },
  ],
  python: [
    { vendor: "Python Software Foundation", product: "CPython" },
  ],
  "apache-http-server": [
    { vendor: "Apache Software Foundation", product: "Apache HTTP Server" },
  ],
  caddy: [
    { vendor: "caddyserver", product: "caddy" },
  ],
  haproxy: [
    { vendor: "HAProxy", product: "HAProxy" },
  ],
  squid: [
    { vendor: "squid-cache", product: "squid" },
  ],
  traefik: [
    { vendor: "traefik", product: "traefik" },
  ],
  // October 2026 lot: pairs that pass the suggestion rules (at least 3 shared CVE, share 0.2,
  // precision 0.5) on the NVD lists of the entry's identifiers.
  centreon: [
    { vendor: "Centreon", product: "Centreon" },
    { vendor: "Centreon", product: "Infra Monitoring" },
    { vendor: "Centreon", product: "web" },
  ],
  "citrix-vad": [
    { vendor: "n/a", product: "Citrix Virtual Apps and Desktops" },
  ],
  clickhouse: [
    { vendor: "ClickHouse", product: "ClickHouse" },
    { vendor: "n/a", product: "ClickHouse" },
    { vendor: "yandex", product: "clickhouse" },
  ],
  "docker-engine": [
    { vendor: "moby", product: "moby" },
  ],
  go: [
    { vendor: "golang", product: "go" },
  ],
  graylog: [
    { vendor: "Graylog2", product: "graylog2-server" },
  ],
  harbor: [
    { vendor: "n/a", product: "Harbor" },
  ],
  "ibm-mq": [
    { vendor: "IBM", product: "MQ" },
  ],
  icinga: [
    { vendor: "Icinga", product: "icinga2" },
  ],
  keycloak: [
    { vendor: "n/a", product: "keycloak" },
  ],
  kubernetes: [
    { vendor: "Kubernetes", product: "Kubernetes" },
  ],
  mariadb: [
    { vendor: "MariaDB", product: "server" },
  ],
  "mulesoft-runtime": [
    { vendor: "n/a", product: "Mulesoft" },
  ],
  mysql: [
    { vendor: "Oracle Corporation", product: "MySQL Server" },
  ],
  neo4j: [
    { vendor: "neo4j", product: "Enterprise Edition" },
  ],
  nginx: [
    { vendor: "f5", product: "nginx" },
  ],
  opensearch: [
    { vendor: "opensearch-project", product: "security" },
  ],
  opnsense: [
    { vendor: "Opnsense", product: "OPNsense" },
  ],
  "veeam-one": [
    { vendor: "Veeam", product: "One" },
  ],
  // October 2026, catalogue enrichi: publisher names from CVE.org
  // (planning/catalogue-enrichi/cve-names.json). A name that carries a release keeps its
  // version. Stormshield is added by hand: ten CVE in the window, a precise name, and the
  // thresholds could not be measured without an NVD analysis.
  "apache-airflow": [
    { vendor: "Apache Software Foundation", product: "Apache Airflow", version: null },
  ],
  "apache-spark": [
    { vendor: "Apache Software Foundation", product: "Apache Spark", version: null },
  ],
  "apache-struts": [
    { vendor: "Apache Software Foundation", product: "Apache Struts", version: null },
  ],
  "arista-eos": [
    { vendor: "Arista Networks", product: "EOS", version: null },
  ],
  "artifactory": [
    { vendor: "jfrog", product: "artifactory", version: null },
  ],
  "aruba-aos-cx": [
    { vendor: "Hewlett Packard Enterprise (HPE)", product: "AOS-CX", version: null },
  ],
  "azure-devops-server": [
    { vendor: "Microsoft", product: "Azure DevOps Server 2022", version: "2022" },
  ],
  "big-ip": [
    { vendor: "F5", product: "BIG-IP", version: null },
  ],
  "bitbucket": [
    { vendor: "Atlassian", product: "Bitbucket Data Center", version: null },
  ],
  "check-point-gaia": [
    { vendor: "checkpoint", product: "Quantum Security Gateway", version: null },
    { vendor: "checkpoint", product: "Quantum Security Management", version: null },
    { vendor: "checkpoint", product: "Check Point Mobile Access", version: null },
  ],
  "cisco-asa": [
    { vendor: "Cisco", product: "Cisco Secure Firewall Adaptive Security Appliance (ASA) Software", version: null },
    { vendor: "Cisco", product: "Cisco Adaptive Security Appliance (ASA) Software", version: null },
    { vendor: "cisco", product: "adaptive_security_appliance_software", version: null },
  ],
  "cisco-ftd": [
    { vendor: "Cisco", product: "Cisco Secure Firewall Threat Defense (FTD) Software", version: null },
    { vendor: "Cisco", product: "Cisco Firepower Threat Defense Software", version: null },
    { vendor: "cisco", product: "firepower_threat_defense_software", version: null },
  ],
  "cisco-ios-xe": [
    { vendor: "Cisco", product: "Cisco IOS XE Software", version: null },
  ],
  "cisco-nx-os": [
    { vendor: "Cisco", product: "Cisco NX-OS Software", version: null },
  ],
  "confluence": [
    { vendor: "Atlassian", product: "Confluence Data Center", version: null },
    { vendor: "Atlassian", product: "Confluence Server", version: null },
  ],
  "consul": [
    { vendor: "HashiCorp", product: "Consul", version: null },
    { vendor: "HashiCorp", product: "Consul Enterprise", version: null },
  ],
  "cortex-xdr": [
    { vendor: "Palo Alto Networks", product: "Cortex XDR Agent", version: null },
  ],
  "dell-data-domain": [
    { vendor: "Dell", product: "PowerProtect Data Domain", version: null },
    { vendor: "Dell", product: "PowerProtect Data Domain with Data Domain Operating System (DD OS) LTS2023", version: null },
    { vendor: "Dell", product: "PowerProtect Data Domain with Data Domain Operating System (DD OS) LTS2024", version: null },
    { vendor: "Dell", product: "PowerProtect Data Domain with Data Domain Operating System (DD OS) of Feature Release", version: null },
  ],
  "dell-powerscale": [
    { vendor: "Dell", product: "PowerScale OneFS", version: null },
  ],
  "dell-powerstore": [
    { vendor: "Dell", product: "PowerStore 500T", version: null },
    { vendor: "Dell", product: "PowerStore 1000T", version: null },
    { vendor: "Dell", product: "PowerStore 1200T", version: null },
    { vendor: "Dell", product: "PowerStore 3000T", version: null },
    { vendor: "Dell", product: "PowerStore 3200Q", version: null },
    { vendor: "Dell", product: "PowerStore 3200T", version: null },
    { vendor: "Dell", product: "PowerStore 5000T", version: null },
    { vendor: "Dell", product: "PowerStore 5200Q", version: null },
    { vendor: "Dell", product: "PowerStore 5200T", version: null },
    { vendor: "Dell", product: "PowerStore 7000T", version: null },
    { vendor: "Dell", product: "PowerStore 9000T", version: null },
    { vendor: "Dell", product: "PowerStore 9200T", version: null },
  ],
  "dell-unity": [
    { vendor: "Dell", product: "Unity", version: null },
  ],
  "drupal": [
    { vendor: "Drupal", product: "Drupal core", version: null },
  ],
  "envoy": [
    { vendor: "envoyproxy", product: "envoy", version: null },
  ],
  "exim": [
    { vendor: "Exim", product: "Exim", version: null },
  ],
  "fortios": [
    { vendor: "Fortinet", product: "FortiOS", version: null },
  ],
  "gitlab": [
    { vendor: "GitLab", product: "GitLab", version: null },
  ],
  "ibm-aix": [
    { vendor: "IBM", product: "AIX", version: null },
  ],
  "ibm-i": [
    { vendor: "IBM", product: "i", version: null },
  ],
  "ibm-websphere": [
    { vendor: "IBM", product: "WebSphere Application Server", version: null },
  ],
  "istio": [
    { vendor: "istio", product: "istio", version: null },
  ],
  "ivanti-connect-secure": [
    { vendor: "Ivanti", product: "Connect Secure", version: null },
  ],
  "jira-service-management": [
    { vendor: "Atlassian", product: "Jira Service Management Data Center", version: null },
    { vendor: "Atlassian", product: "Jira Service Management Server", version: null },
  ],
  "jira-software": [
    { vendor: "Atlassian", product: "Jira Server", version: null },
    { vendor: "Atlassian", product: "Jira Data Center", version: null },
  ],
  "juniper-junos": [
    { vendor: "Juniper Networks", product: "Junos OS", version: null },
    { vendor: "Juniper Networks", product: "Junos OS Evolved", version: null },
  ],
  "kibana": [
    { vendor: "Elastic", product: "Kibana", version: null },
  ],
  "log4j": [
    { vendor: "Apache Software Foundation", product: "Apache Log4j Core", version: null },
  ],
  "logstash": [
    { vendor: "Elastic", product: "Logstash", version: null },
  ],
  "netapp-ontap": [
    { vendor: "NetApp", product: "ONTAP 9", version: "9" },
  ],
  "netscaler-adc": [
    { vendor: "NetScaler", product: "ADC", version: null },
    { vendor: "NetScaler", product: "Gateway", version: null },
    { vendor: "Citrix NetScaler", product: "ADC", version: null },
    { vendor: "Citrix NetScaler", product: "Gateway", version: null },
  ],
  "nexus": [
    { vendor: "Sonatype", product: "Nexus Repository 3", version: "3" },
    { vendor: "Sonatype", product: "Nexus Repository", version: null },
  ],
  "oracle-solaris": [
    { vendor: "Oracle Corporation", product: "Oracle Solaris", version: null },
  ],
  "oracle-weblogic": [
    { vendor: "Oracle Corporation", product: "Oracle WebLogic Server", version: null },
    { vendor: "Oracle Corporation", product: "WebLogic Server", version: null },
  ],
  "pangp": [
    { vendor: "Palo Alto Networks", product: "GlobalProtect App", version: null },
    { vendor: "Palo Alto Networks", product: "GlobalProtect UWP App", version: null },
  ],
  "panos": [
    { vendor: "Palo Alto Networks", product: "PAN-OS", version: null },
  ],
  "pure-purity-fa": [
    { vendor: "PureStorage", product: "FlashArray", version: null },
  ],
  "routeros": [
    { vendor: "Mikrotik", product: "RouterOS", version: null },
  ],
  "sharepoint": [
    { vendor: "Microsoft", product: "Microsoft SharePoint Server Subscription Edition", version: "Subscription Edition" },
    { vendor: "Microsoft", product: "Microsoft SharePoint Server 2019", version: "2019" },
    { vendor: "Microsoft", product: "Microsoft SharePoint Enterprise Server 2016", version: "2016" },
  ],
  "sns-firmware": [
    { vendor: "Stormshield", product: "Stormshield Network Security", version: null },
  ],
  "solr": [
    { vendor: "Apache Software Foundation", product: "Apache Solr", version: null },
  ],
  "sonarqube-server": [
    { vendor: "SonarSource", product: "SonarQube", version: null },
  ],
  "sophos-firewall": [
    { vendor: "Sophos", product: "Sophos Firewall", version: null },
  ],
  "spring-boot": [
    { vendor: "Spring", product: "Spring Boot", version: null },
  ],
  "spring-framework": [
    { vendor: "Spring", product: "Spring Framework", version: null },
  ],
  "synology-dsm": [
    { vendor: "Synology", product: "DiskStation Manager (DSM)", version: null },
  ],
  "wordpress": [
    { vendor: "WordPress", product: "WordPress", version: null },
  ],
  "zookeeper": [
    { vendor: "Apache Software Foundation", product: "Apache ZooKeeper", version: null },
  ],
};
for (const entry of PRODUCTS) if (CVE_NAMES[entry.key]) entry.cve_names = CVE_NAMES[entry.key];

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

// The living catalog (lot C4) reads endoflife.date between two KANAP versions with the same rules:
// backend/src/technologies/catalog/catalog-releases.ts repeats `cleanLabel`, `cpeVersionOf` (with the
// `cpeVersion` and `cpeVersions` of PRODUCTS) and `versionsOf`. Change both; its spec checks that it
// gives back the `cpe_version` of every shipped version. There too, `productPerRelease` gives a SQL
// Server release published between two versions its `a:microsoft:sql_server_<year>` product, and a
// Windows Server release from 2003 its `o:microsoft:windows_server_<year>` (Windows 2000 stays out:
// the NVD names it `windows_2000`).

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
 *   `exchange_server_subscription_edition` (`< 15.02.2562.017`); Ivanti `9.1R18` → `9.1` (the
 *   maintenance release is the NVD update); Cortex XDR `7.9.103-ce` → `7.9.103`;
 * - Oracle Database and Check Point Gaia (`cpeVersion: 'label'`): the label in lower case.
 *   Oracle is `19c`; Gaia is `r81.20`;
 * - `escaped-parens`: one ASA or NX-OS version, parentheses escaped and lower case
 *   (`9.16(4.51)` → `9.16\(4.51\)`, `7.0(3)I7(x)` → `7.0\(3\)i7\(x\)`). A label that is not one
 *   version (`7.0(3)F3(3-5)`, `7.0(3)F1/2(x)`) stays null;
 * - `strip-x`: a train written `4.36.x` or `15.x` gives `4.36` or `15` (a branch the matching
 *   compares). Any other label of that entry uses the two rules above.
 * Twin of `cpeVersionOf` in catalog-releases.ts (`CPE_VERSION_RULES`).
 */
function escapedParensVersion(text) {
  const lower = text.toLowerCase();
  if (!/^\d+(?:\.\d+)*(?:\([0-9a-z]+\)|[a-z]+\d*)+$/.test(lower)) return null;
  return lower.replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function cpeVersionOf(label, entry) {
  const text = String(label ?? '').trim();
  if (entry?.cpeVersion === 'label') return text.toLowerCase() || null;
  for (const [pattern, version] of entry?.cpeVersions ?? []) if (pattern.test(text)) return version;
  if (entry?.cpeVersion === 'escaped-parens') {
    const escaped = escapedParensVersion(text);
    if (escaped) return escaped;
  }
  if (entry?.cpeVersion === 'strip-x') {
    const train = /^(\d+(?:\.\d+)*)\.x$/i.exec(text);
    if (train) return train[1];
  }
  if (/^v?\d+(\.\d+)*[a-z]*$/i.test(text)) return null;
  return text.split(/\s+/).find((token) => /^\d+(\.\d+)*$/.test(token)) ?? null;
}

const day = (value) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);

/**
 * Operating systems keep the meaning of the former IT settings catalog. eol_then_paid (Ubuntu,
 * RHEL and its rebuilds, SLES): standard = end of security fixes (eolFrom), extended = paid
 * extension (eoesFrom: ESM, ELS, LTSS) or nothing. active_then_eol (Windows Server, Debian):
 * standard = end of mainstream or regular security support, extended = end of extended support or
 * of Debian LTS (eolFrom). Twin of SUPPORT_RULES in backend/src/technologies/catalog/catalog-releases.ts.
 * Amazon Linux: standard support ends at `eoasFrom`, security support at `eolFrom` (`active_then_eol`).
 * Alpine, AIX, IBM i and Solaris: `eolFrom` is the end of regular support and `eoesFrom` the paid
 * extension when published (`eol_then_paid`). IBM i and Solaris publish that extension; AIX and
 * Alpine publish a single end.
 */
const SUPPORT_RULES = {
  ubuntu: 'eol_then_paid',
  rhel: 'eol_then_paid',
  debian: 'active_then_eol',
  sles: 'eol_then_paid',
  'rocky-linux': 'eol_then_paid',
  almalinux: 'eol_then_paid',
  'oracle-linux': 'eol_then_paid',
  centos: 'eol_then_paid',
  'windows-server': 'active_then_eol',
  'amazon-linux': 'active_then_eol',
  'alpine-linux': 'eol_then_paid',
  'ibm-aix': 'eol_then_paid',
  'ibm-i': 'eol_then_paid',
  'oracle-solaris': 'eol_then_paid',
};

/** Other products: standard = end of active support, else end of life; extended = paid extension, else end of life after an active support. */
function supportDates(key, eoas, eol, eoes) {
  const rule = SUPPORT_RULES[key];
  let standard;
  let extended;
  if (rule === 'eol_then_paid') {
    standard = eol ?? eoas;
    extended = eoes;
  } else if (rule === 'active_then_eol') {
    standard = eoas ?? eol;
    extended = eoas ? eol : null;
  } else {
    standard = eoas ?? eol;
    extended = eoes ?? (eoas ? eol : null);
  }
  if (standard && extended && extended <= standard) extended = null;
  return { standard, extended };
}

function versionsOf(releases, today, entry) {
  const os = entry.family === 'operating_system';
  const cutoff = os ? OS_SUPPORT_ENDED_SINCE : `${Number(today.slice(0, 4)) - ENDED_YEARS_KEPT}${today.slice(4)}`;
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
    if (entry.keepRelease && !entry.keepRelease(release)) continue;
    const name = String(release.name);
    // The eight newest; every one in the window for an operating system.
    if (!os && out.length >= MAX_VERSIONS) break;
    const label = entry.versionLabel ? entry.versionLabel(release) : cleanLabel(release.label, release.name);
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    const { standard, extended } = supportDates(entry.key, eoas, eol, eoes);
    // Twin of versionsOfReleases: AIX keys the folded label. Windows keys stay the cycle name.
    const folded = entry.key === 'ibm-aix';
    out.push({
      key: folded ? label : name,
      label,
      cpe_version: cpeVersionOf(label, entry),
      build_prefixes: folded ? [] : (name !== label && /^\d+(\.\d+)*$/.test(name) ? [name] : []),
      release_date: day(release.releaseDate),
      standard_support_end: standard,
      extended_support_end: extended,
    });
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
 * the file are kept otherwise), the `cve_names` and the `hosting_type` of PRODUCTS copied,
 * nothing fetched.
 */

/** Comparison key of a CVE.org vendor or product. Twin of `cveNameKey` in cve-record.ts. */
function cveNameKey(text) {
  return String(text ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function cveNameIdentity(name) {
  return `${cveNameKey(name.vendor)}\0${cveNameKey(name.product)}\0${String(name.version ?? '').trim()}`;
}

function cveNameText(value, key, place, field, max) {
  if (typeof value !== 'string') throw new Error(`${key}: CVE name ${place} needs a ${field} of 1 to ${max} characters.`);
  const text = value.trim();
  if (text.length < 1 || text.length > max) throw new Error(`${key}: CVE name ${place} needs a ${field} of 1 to ${max} characters.`);
  return text;
}

/**
 * `cve_names` of a PRODUCTS entry, sorted, or null when the entry has none. The same checks as
 * `normalizeCveNames`: an array of at most 50 objects, a vendor and a product of 1 to 200
 * characters, an optional version of at most 50, and no repeated vendor, product and version.
 */
function cveNamesOf(entry) {
  if (!entry || entry.cve_names == null) return null;
  const input = entry.cve_names;
  if (!Array.isArray(input)) throw new Error(`${entry.key}: CVE names must be an array.`);
  if (input.length > 50) throw new Error(`${entry.key}: a technology carries at most 50 CVE names.`);
  const seen = new Set();
  const names = input.map((item, index) => {
    const place = index + 1;
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${entry.key}: CVE name ${place} must be an object.`);
    const vendor = cveNameText(item.vendor, entry.key, place, 'vendor', 200);
    const product = cveNameText(item.product, entry.key, place, 'product', 200);
    let version = null;
    if ('version' in item && item.version != null) {
      if (typeof item.version !== 'string') throw new Error(`${entry.key}: CVE name ${place} has a version that must be text of at most 50 characters.`);
      const text = item.version.trim();
      if (text.length > 50) throw new Error(`${entry.key}: CVE name ${place} has a version longer than 50 characters.`);
      version = text || null;
    }
    const name = { vendor, product, version };
    const identity = cveNameIdentity(name);
    if (seen.has(identity)) throw new Error(`${entry.key}: CVE name ${place} repeats a vendor, product and version already listed.`);
    seen.add(identity);
    return name;
  });
  names.sort((a, b) =>
    a.vendor.localeCompare(b.vendor, 'en', { sensitivity: 'base' })
    || a.product.localeCompare(b.product, 'en', { sensitivity: 'base' })
    || (a.version ?? '').localeCompare(b.version ?? '', 'en', { sensitivity: 'base' }));
  return names;
}
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
    if (entry?.noCpe) product.noCpe = entry.noCpe;
    else delete product.noCpe;
    if (entry?.security_tracker) product.security_tracker = entry.security_tracker;
    else delete product.security_tracker;
    const names = cveNamesOf(entry);
    if (names) product.cve_names = names;
    else delete product.cve_names;
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
/**
 * The NVD allows 5 requests in a rolling 30 seconds without a key (one every 6.5 s) and 50 with
 * one (one every 0.7 s). Same header as the backend feed (`apiKey`). The value is never logged.
 */
const NVD_API_KEY = (process.env.NVD_API_KEY ?? '').trim();
const NVD_SPACING_MS = NVD_API_KEY ? 700 : 6500;
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
      const headers = { accept: 'application/json', ...(NVD_API_KEY ? { apiKey: NVD_API_KEY } : {}) };
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(120_000) });
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

const CURATED_DIR = resolve(ROOT, 'backend/src/technologies/catalog/curated');
/** A build an observed version can start with: digits and dots only (`7.3`, `4.0.1.0`). */
const NUMERIC_PREFIX = /^\d+(\.\d+)*$/;
const CURATED_DATE_FIELDS = ['release_date', 'standard_support_end', 'extended_support_end'];

/** A real calendar day `YYYY-MM-DD`, the form the curated files store. */
function isIsoDay(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const dayOfMonth = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, dayOfMonth));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === dayOfMonth;
}

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\/\S+$/.test(value);
}

function curatedFileNames() {
  return readdirSync(CURATED_DIR).filter((name) => name.endsWith('.json')).sort();
}

function readCuratedFile(key) {
  return JSON.parse(readFileSync(resolve(CURATED_DIR, `${key}.json`), 'utf8'));
}

/**
 * Numeric aliases only, in the file's order, never the label itself. `LTS2026`, `R80.30` and
 * `22.0 MR2` name the same row for a reader; they are not a build prefix.
 */
function buildPrefixesOf(label, aliases) {
  const prefixes = [];
  for (const alias of Array.isArray(aliases) ? aliases : []) {
    if (typeof alias !== 'string' || !NUMERIC_PREFIX.test(alias) || alias === label || prefixes.includes(alias)) continue;
    prefixes.push(alias);
  }
  return prefixes;
}

/** Versions of a KANAP-maintained product, in the file's order. `note` and the other curation fields stay out. */
function versionsOfCurated(file, entry) {
  return file.versions.map((version) => {
    const label = String(version.label);
    return {
      key: label,
      label,
      release_date: version.release_date ?? null,
      standard_support_end: version.standard_support_end ?? null,
      extended_support_end: version.extended_support_end ?? null,
      cpe_version: cpeVersionOf(label, entry),
      build_prefixes: buildPrefixesOf(label, version.aliases),
      source_url: version.source_url,
      checked_on: version.checked_on,
      no_planned_end: version.no_planned_end === true,
    };
  });
}

/** One curated file: required fields, ISO dates, date order, unique labels, and `no_planned_end`. */
function checkCuratedDocument(key, file, findings) {
  if (!file || typeof file !== 'object' || Array.isArray(file)) {
    findings.push(`${key}: curated file must be an object`);
    return;
  }
  if (file.key !== key) findings.push(`${key}: file key is ${JSON.stringify(file.key)}`);
  for (const field of ['name', 'editor', 'family']) {
    if (typeof file[field] !== 'string' || !file[field].trim()) findings.push(`${key}: ${field} is missing`);
  }
  if (!isHttpUrl(file.lifecycle_url)) findings.push(`${key}: lifecycle_url must be an http(s) URL`);
  if (!('source_updated' in file)) findings.push(`${key}: source_updated is missing`);
  else if (file.source_updated !== null && !isIsoDay(file.source_updated)) findings.push(`${key}: source_updated must be an ISO date or null`);
  if (!Array.isArray(file.versions) || file.versions.length === 0) {
    findings.push(`${key}: versions must be a non-empty array`);
    return;
  }
  const labels = new Set();
  for (const version of file.versions) {
    if (!version || typeof version !== 'object' || Array.isArray(version)) {
      findings.push(`${key}: a version is not an object`);
      continue;
    }
    const label = version.label;
    const place = typeof label === 'string' && label.trim() ? label : '(no label)';
    if (typeof label !== 'string' || label.length < 1 || label.length > 100 || label !== label.trim()) {
      findings.push(`${key}: a version label must be 1 to 100 characters`);
    } else if (labels.has(label)) {
      findings.push(`${key}: label ${label} is repeated`);
    } else {
      labels.add(label);
    }
    for (const field of CURATED_DATE_FIELDS) {
      if (!(field in version)) findings.push(`${key}: ${place}: ${field} is missing`);
      else if (version[field] !== null && !isIsoDay(version[field])) findings.push(`${key}: ${place}: ${field} must be an ISO date or null`);
    }
    if (!isIsoDay(version.checked_on)) findings.push(`${key}: ${place}: checked_on must be an ISO date`);
    if (!isHttpUrl(version.source_url)) findings.push(`${key}: ${place}: source_url must be an http(s) URL`);
    if (typeof version.no_planned_end !== 'boolean') {
      findings.push(`${key}: ${place}: no_planned_end must be a boolean`);
    } else if (version.no_planned_end === true && (version.standard_support_end !== null || version.extended_support_end !== null)) {
      findings.push(`${key}: ${place}: no_planned_end requires both end dates to be null`);
    }
    const ordered = CURATED_DATE_FIELDS
      .map((field) => [field, version[field]])
      .filter(([, value]) => value != null);
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index][1] < ordered[index - 1][1]) {
        findings.push(`${key}: ${place}: ${ordered[index - 1][0]} ${ordered[index - 1][1]} is after ${ordered[index][0]} ${ordered[index][1]}`);
      }
    }
  }
}

/**
 * Each file in `curated/` has a PRODUCTS entry `curated: true` (and the reverse), with the fields
 * and the date rules the catalog build reads. Offline: nothing is fetched.
 */
function checkCurated(findings) {
  let names;
  try {
    names = curatedFileNames();
  } catch (error) {
    findings.push(`curated: ${CURATED_DIR} cannot be read (${error instanceof Error ? error.message : error})`);
    return;
  }
  const fileKeys = new Set(names.map((name) => name.slice(0, -'.json'.length)));
  for (const entry of PRODUCTS) {
    if (!entry.curated) continue;
    if (!fileKeys.has(entry.key)) findings.push(`${entry.key}: curated product without a file in curated/`);
    if (entry.slug) findings.push(`${entry.key}: curated product has slug ${JSON.stringify(entry.slug)}`);
  }
  for (const key of fileKeys) {
    const entry = PRODUCTS.find((product) => product.key === key);
    if (!entry?.curated) findings.push(`${key}: curated file without a curated: true product`);
    let file;
    try {
      file = readCuratedFile(key);
    } catch (error) {
      findings.push(`${key}: curated file is not valid JSON (${error instanceof Error ? error.message : error})`);
      continue;
    }
    checkCuratedDocument(key, file, findings);
  }
}

/**
 * `--check-cpe`: every entry of the file has well-formed identifiers or a `noCpe` reason, and
 * matches PRODUCTS (no `cpeExclude` left, every `cpe` present, and `cve_names` equal to PRODUCTS).
 * Each file in `curated/` matches a `curated: true` product. With --nvd, each identifier is
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
  checkCurated(findings);
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
    let expectedNames = null;
    let fileNames = null;
    try {
      expectedNames = cveNamesOf(entry);
    } catch (error) {
      findings.push(error instanceof Error ? error.message : String(error));
    }
    if (product.cve_names !== undefined) {
      try {
        fileNames = cveNamesOf({ key: product.key, cve_names: product.cve_names });
      } catch (error) {
        findings.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (JSON.stringify(expectedNames) !== JSON.stringify(fileNames)) {
      findings.push(`${product.key}: cve_names differs from PRODUCTS, run --refresh-cpe-versions`);
    }
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
    const remote = entry.slug && !entry.curated ? await fetchProduct(entry.slug) : null;
    const curated = entry.curated ? readCuratedFile(entry.key) : null;
    const published = [];
    for (const identifier of remote?.identifiers ?? []) {
      if (identifier.type !== 'cpe') continue;
      const product = cpeProduct(identifier.id);
      if (product) published.push(product);
    }
    const cpe = cpeProductsOf(entry, published);
    const names = cveNamesOf(entry);
    products.push({
      key: entry.key,
      name: entry.name,
      editor: entry.editor,
      family: entry.family,
      mode: entry.mode ?? 'installed',
      ...(entry.hosting_type ? { hosting_type: entry.hosting_type } : {}),
      cpe_products: cpe,
      ...(entry.noCpe ? { noCpe: entry.noCpe } : {}),
      ...(names ? { cve_names: names } : {}),
      source_url: curated ? curated.lifecycle_url : (entry.slug ? `https://endoflife.date/${entry.slug}` : null),
      ...(curated ? { source_updated: curated.source_updated ?? null } : {}),
      ...(entry.security_tracker ? { security_tracker: entry.security_tracker } : {}),
      versions: curated ? versionsOfCurated(curated, entry) : (remote ? versionsOf(remote.releases ?? [], today, entry) : []),
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
