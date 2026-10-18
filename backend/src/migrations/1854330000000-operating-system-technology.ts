import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The operating system of a server becomes a technology (lot T3).
 *
 * `asset_technologies.is_operating_system` marks the one technology that is the server's
 * operating system. A partial unique index keeps a single mark per server, whatever the
 * technology's family. `assets.operating_system` and the IT settings catalog `operating_systems`
 * go away once their values are technologies.
 *
 * Per tenant, with `app.current_tenant` set (`technologies` writes `search_index` through a
 * trigger): each distinct code on an asset, in the settings catalog, or in a Netbox `os_map`
 * (a value with no space; a value that already reads as a label is left alone) becomes a
 * technology. A shipped code (the 19 below, copied here so the migration imports no application
 * code) adopts the frozen product of the shipped catalog. Any other code is matched by name
 * without case, in every family, or created in the family `operating_system` (`other` when the
 * tenant's catalog dropped that family). A last token that starts with a digit is the version
 * (`VMware ESXi 8.0`). An orphan code, on an asset and in neither the shipped list nor the
 * tenant's catalog, is humanized first (`foo_bar_2` → `foo bar 2`).
 *
 * Version dates already set are kept. Empty dates take the shipped catalog's, then the dates
 * the settings entry stored. A technology this migration inserts is set to `retired` only when
 * every settings entry that resolved to it is deprecated and no other version of it is installed
 * on an asset. Versions copied from the catalog and not installed do not count as used. A
 * technology that already existed keeps its lifecycle and its family.
 *
 * The marked link reuses a link of the same technology (a link with no version takes the version),
 * or is created. A marked link of another technology is deleted: a link that only existed to hold
 * the operating system cannot be told from any other link. Provenance is `manual`.
 *
 * The asset search document stops reading `assets.operating_system` before the column goes.
 * The operating system is not copied back into that document: the technology is indexed itself.
 * There is no rebuild of the index.
 *
 * A second run, once the column is gone, adds nothing. `down()` puts the column and the settings
 * catalog back from the marked links (a shipped code when the table gives one, otherwise the
 * label in snake case), restores the search function, and drops the mark. It does not delete
 * the technologies. Settings entries no asset uses do not come back. Netbox `os_map` stays in
 * labels: they are what the field stores from here on.
 */

type FrozenVersion = {
  key: string;
  label: string;
  cpe_version: string | null;
  build_prefixes: string[];
  standard_support_end: string | null;
  extended_support_end: string | null;
};

type FrozenProduct = {
  key: string;
  name: string;
  editor: string;
  family: string;
  description: string;
  versions: FrozenVersion[];
};

export type ShippedOsCode = {
  code: string;
  product: string;
  version: string;
  standardSupportEnd: string;
  extendedSupportEnd: string;
};

/** Twin of `OPERATING_SYSTEM_CODES`. The spec checks the two lists are equal. */
export const SHIPPED_OS_CODES: readonly ShippedOsCode[] = [
  { code: 'windows_server_2012_r2', product: 'windows-server', version: '2012 R2', standardSupportEnd: '2018-10-09', extendedSupportEnd: '2023-10-10' },
  { code: 'windows_server_2016', product: 'windows-server', version: '2016', standardSupportEnd: '2022-01-11', extendedSupportEnd: '2027-01-12' },
  { code: 'windows_server_2019', product: 'windows-server', version: '2019', standardSupportEnd: '2024-01-09', extendedSupportEnd: '2029-01-09' },
  { code: 'windows_server_2022', product: 'windows-server', version: '2022', standardSupportEnd: '2026-10-13', extendedSupportEnd: '2031-10-14' },
  { code: 'windows_server_2025', product: 'windows-server', version: '2025', standardSupportEnd: '2029-11-13', extendedSupportEnd: '2034-11-14' },
  { code: 'ubuntu_18_04_lts', product: 'ubuntu', version: '18.04 LTS', standardSupportEnd: '2023-05-31', extendedSupportEnd: '2028-04-30' },
  { code: 'ubuntu_20_04_lts', product: 'ubuntu', version: '20.04 LTS', standardSupportEnd: '2025-05-31', extendedSupportEnd: '2030-05-31' },
  { code: 'ubuntu_22_04_lts', product: 'ubuntu', version: '22.04 LTS', standardSupportEnd: '2027-04-30', extendedSupportEnd: '2032-04-30' },
  { code: 'ubuntu_24_04_lts', product: 'ubuntu', version: '24.04 LTS', standardSupportEnd: '2029-04-30', extendedSupportEnd: '2034-04-30' },
  { code: 'rhel_7', product: 'rhel', version: '7', standardSupportEnd: '2024-06-30', extendedSupportEnd: '2029-05-31' },
  { code: 'rhel_8', product: 'rhel', version: '8', standardSupportEnd: '2024-05-31', extendedSupportEnd: '2029-05-31' },
  { code: 'rhel_9', product: 'rhel', version: '9', standardSupportEnd: '2027-05-31', extendedSupportEnd: '2032-05-31' },
  { code: 'debian_10_buster', product: 'debian', version: '10 (Buster)', standardSupportEnd: '2022-09-10', extendedSupportEnd: '2024-06-30' },
  { code: 'debian_11_bullseye', product: 'debian', version: '11 (Bullseye)', standardSupportEnd: '2024-07-01', extendedSupportEnd: '2026-06-30' },
  { code: 'debian_12_bookworm', product: 'debian', version: '12 (Bookworm)', standardSupportEnd: '2026-06-10', extendedSupportEnd: '2028-06-30' },
  { code: 'sles_12_sp5', product: 'sles', version: '12 SP5', standardSupportEnd: '2024-10-31', extendedSupportEnd: '2027-10-31' },
  { code: 'sles_15_sp5', product: 'sles', version: '15 SP5', standardSupportEnd: '2025-12-31', extendedSupportEnd: '2028-12-31' },
  { code: 'sles_15_sp6', product: 'sles', version: '15 SP6', standardSupportEnd: '2028-12-31', extendedSupportEnd: '2031-12-31' },
  { code: 'sles_15_sp7', product: 'sles', version: '15 SP7', standardSupportEnd: '2031-07-31', extendedSupportEnd: '2034-06-30' },
];

const SHIPPED_BY_CODE = new Map(SHIPPED_OS_CODES.map((entry) => [entry.code, entry]));

/** Frozen operating-system products, copied from the shipped catalog when this migration was written. */
export const OS_PRODUCTS: readonly FrozenProduct[] = JSON.parse("[{\"key\":\"almalinux\",\"name\":\"AlmaLinux\",\"editor\":\"AlmaLinux OS Foundation\",\"family\":\"operating_system\",\"description\":\"Community Linux distribution rebuilt from Red Hat Enterprise Linux, published by the AlmaLinux OS Foundation.\",\"versions\":[{\"key\":\"10\",\"label\":\"10\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2030-05-31\",\"extended_support_end\":\"2035-05-31\"},{\"key\":\"9\",\"label\":\"9\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2027-05-31\",\"extended_support_end\":\"2032-05-31\"},{\"key\":\"8\",\"label\":\"8\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2024-05-31\",\"extended_support_end\":\"2029-05-31\"}]},{\"key\":\"centos\",\"name\":\"CentOS\",\"editor\":\"The CentOS Project\",\"family\":\"operating_system\",\"description\":\"Community Linux distribution rebuilt from Red Hat Enterprise Linux. CentOS Linux ended with version 7; later builds are CentOS Stream.\",\"versions\":[{\"key\":\"7\",\"label\":\"7\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2020-08-06\",\"extended_support_end\":\"2024-06-30\"}]},{\"key\":\"debian\",\"name\":\"Debian\",\"editor\":\"Debian\",\"family\":\"operating_system\",\"description\":\"Community Linux distribution, published about every two years as a stable release named after a Toy Story character.\",\"versions\":[{\"key\":\"13\",\"label\":\"13 (Trixie)\",\"cpe_version\":\"13\",\"build_prefixes\":[\"13\"],\"standard_support_end\":\"2028-08-09\",\"extended_support_end\":\"2035-06-30\"},{\"key\":\"12\",\"label\":\"12 (Bookworm)\",\"cpe_version\":\"12\",\"build_prefixes\":[\"12\"],\"standard_support_end\":\"2026-07-11\",\"extended_support_end\":\"2033-06-30\"},{\"key\":\"11\",\"label\":\"11 (Bullseye)\",\"cpe_version\":\"11\",\"build_prefixes\":[\"11\"],\"standard_support_end\":\"2024-08-14\",\"extended_support_end\":\"2031-06-30\"},{\"key\":\"10\",\"label\":\"10 (Buster)\",\"cpe_version\":\"10\",\"build_prefixes\":[\"10\"],\"standard_support_end\":\"2022-09-10\",\"extended_support_end\":\"2029-06-30\"},{\"key\":\"9\",\"label\":\"9 (Stretch)\",\"cpe_version\":\"9\",\"build_prefixes\":[\"9\"],\"standard_support_end\":\"2020-07-18\",\"extended_support_end\":\"2027-06-30\"},{\"key\":\"8\",\"label\":\"8 (Jessie)\",\"cpe_version\":\"8\",\"build_prefixes\":[\"8\"],\"standard_support_end\":\"2018-06-17\",\"extended_support_end\":\"2025-06-30\"}]},{\"key\":\"oracle-linux\",\"name\":\"Oracle Linux\",\"editor\":\"Oracle\",\"family\":\"operating_system\",\"description\":\"Linux distribution from Oracle, rebuilt from Red Hat Enterprise Linux, with optional paid support.\",\"versions\":[{\"key\":\"10\",\"label\":\"10\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2035-06-30\",\"extended_support_end\":\"2038-06-30\"},{\"key\":\"9\",\"label\":\"9\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2032-06-30\",\"extended_support_end\":\"2035-06-30\"},{\"key\":\"8\",\"label\":\"8\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2029-07-31\",\"extended_support_end\":\"2032-07-31\"},{\"key\":\"7\",\"label\":\"7\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2024-12-31\",\"extended_support_end\":\"2029-07-31\"},{\"key\":\"6\",\"label\":\"6\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2021-03-31\",\"extended_support_end\":\"2024-12-31\"}]},{\"key\":\"rhel\",\"name\":\"Red Hat Enterprise Linux\",\"editor\":\"Red Hat\",\"family\":\"operating_system\",\"description\":\"Commercial Linux distribution from Red Hat, with ten years of maintenance and an optional extended life cycle.\",\"versions\":[{\"key\":\"10\",\"label\":\"10\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2030-05-31\",\"extended_support_end\":\"2039-05-31\"},{\"key\":\"9\",\"label\":\"9\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2027-05-31\",\"extended_support_end\":\"2036-05-31\"},{\"key\":\"8\",\"label\":\"8\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2024-05-31\",\"extended_support_end\":\"2033-05-31\"},{\"key\":\"7\",\"label\":\"7\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2019-08-06\",\"extended_support_end\":\"2029-05-31\"},{\"key\":\"6\",\"label\":\"6\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2016-05-10\",\"extended_support_end\":\"2024-06-30\"}]},{\"key\":\"rocky-linux\",\"name\":\"Rocky Linux\",\"editor\":\"Rocky Enterprise Software Foundation\",\"family\":\"operating_system\",\"description\":\"Community Linux distribution rebuilt from Red Hat Enterprise Linux, published by the Rocky Enterprise Software Foundation.\",\"versions\":[{\"key\":\"10\",\"label\":\"10\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2030-05-31\",\"extended_support_end\":\"2035-05-31\"},{\"key\":\"9\",\"label\":\"9\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2027-05-31\",\"extended_support_end\":\"2032-05-31\"},{\"key\":\"8\",\"label\":\"8\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2024-05-31\",\"extended_support_end\":\"2029-05-31\"}]},{\"key\":\"sles\",\"name\":\"SUSE Linux Enterprise Server\",\"editor\":\"SUSE\",\"family\":\"operating_system\",\"description\":\"Commercial Linux distribution from SUSE for servers, published as a major version and its service packs.\",\"versions\":[{\"key\":\"16.0\",\"label\":\"16.0\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2027-11-30\",\"extended_support_end\":\"2030-11-30\"},{\"key\":\"15.7\",\"label\":\"15 SP7\",\"cpe_version\":\"15\",\"build_prefixes\":[\"15.7\"],\"standard_support_end\":\"2031-07-31\",\"extended_support_end\":\"2034-07-31\"},{\"key\":\"15.6\",\"label\":\"15 SP6\",\"cpe_version\":\"15\",\"build_prefixes\":[\"15.6\"],\"standard_support_end\":\"2025-12-31\",\"extended_support_end\":\"2028-12-31\"},{\"key\":\"15.5\",\"label\":\"15 SP5\",\"cpe_version\":\"15\",\"build_prefixes\":[\"15.5\"],\"standard_support_end\":\"2024-12-31\",\"extended_support_end\":\"2027-12-31\"},{\"key\":\"15.4\",\"label\":\"15 SP4\",\"cpe_version\":\"15\",\"build_prefixes\":[\"15.4\"],\"standard_support_end\":\"2023-12-31\",\"extended_support_end\":\"2026-12-31\"},{\"key\":\"15.3\",\"label\":\"15 SP3\",\"cpe_version\":\"15\",\"build_prefixes\":[\"15.3\"],\"standard_support_end\":\"2022-12-31\",\"extended_support_end\":\"2025-12-31\"},{\"key\":\"15.2\",\"label\":\"15 SP2\",\"cpe_version\":\"15\",\"build_prefixes\":[\"15.2\"],\"standard_support_end\":\"2021-12-31\",\"extended_support_end\":\"2024-12-31\"},{\"key\":\"12.5\",\"label\":\"12 SP5\",\"cpe_version\":\"12\",\"build_prefixes\":[\"12.5\"],\"standard_support_end\":\"2024-10-31\",\"extended_support_end\":\"2027-10-31\"}]},{\"key\":\"ubuntu\",\"name\":\"Ubuntu\",\"editor\":\"Canonical\",\"family\":\"operating_system\",\"description\":\"Linux distribution from Canonical, published twice a year, with a long-term support release every two years.\",\"versions\":[{\"key\":\"26.04\",\"label\":\"26.04 LTS\",\"cpe_version\":\"26.04\",\"build_prefixes\":[\"26.04\"],\"standard_support_end\":\"2031-05-29\",\"extended_support_end\":\"2036-04-23\"},{\"key\":\"25.10\",\"label\":\"25.10\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2026-07-01\",\"extended_support_end\":null},{\"key\":\"25.04\",\"label\":\"25.04\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2026-01-17\",\"extended_support_end\":null},{\"key\":\"24.10\",\"label\":\"24.10\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2025-07-10\",\"extended_support_end\":null},{\"key\":\"24.04\",\"label\":\"24.04 LTS\",\"cpe_version\":\"24.04\",\"build_prefixes\":[\"24.04\"],\"standard_support_end\":\"2029-05-31\",\"extended_support_end\":\"2034-04-25\"},{\"key\":\"23.10\",\"label\":\"23.10\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2024-07-12\",\"extended_support_end\":null},{\"key\":\"23.04\",\"label\":\"23.04\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2024-01-20\",\"extended_support_end\":null},{\"key\":\"22.10\",\"label\":\"22.10\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2023-07-20\",\"extended_support_end\":null},{\"key\":\"22.04\",\"label\":\"22.04 LTS\",\"cpe_version\":\"22.04\",\"build_prefixes\":[\"22.04\"],\"standard_support_end\":\"2024-09-30\",\"extended_support_end\":\"2032-04-21\"},{\"key\":\"20.04\",\"label\":\"20.04 LTS\",\"cpe_version\":\"20.04\",\"build_prefixes\":[\"20.04\"],\"standard_support_end\":\"2022-10-01\",\"extended_support_end\":\"2030-04-23\"},{\"key\":\"18.04\",\"label\":\"18.04 LTS\",\"cpe_version\":\"18.04\",\"build_prefixes\":[\"18.04\"],\"standard_support_end\":\"2023-05-31\",\"extended_support_end\":\"2028-04-26\"}]},{\"key\":\"windows-server\",\"name\":\"Windows Server\",\"editor\":\"Microsoft\",\"family\":\"operating_system\",\"description\":\"Microsoft operating system for servers, in long-term releases with a standard support period and an extended one.\",\"versions\":[{\"key\":\"2025\",\"label\":\"2025\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2029-11-13\",\"extended_support_end\":\"2034-11-14\"},{\"key\":\"23h2-ac\",\"label\":\"23H2 AC\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2026-05-12\",\"extended_support_end\":null},{\"key\":\"2022\",\"label\":\"2022\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2026-10-13\",\"extended_support_end\":\"2031-10-14\"},{\"key\":\"2019\",\"label\":\"2019\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2024-01-09\",\"extended_support_end\":\"2029-01-09\"},{\"key\":\"2016\",\"label\":\"2016\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2022-01-11\",\"extended_support_end\":\"2030-01-12\"},{\"key\":\"2012-r2\",\"label\":\"2012 R2\",\"cpe_version\":\"2012\",\"build_prefixes\":[],\"standard_support_end\":\"2018-10-09\",\"extended_support_end\":\"2026-10-13\"},{\"key\":\"2012\",\"label\":\"2012\",\"cpe_version\":null,\"build_prefixes\":[],\"standard_support_end\":\"2018-10-09\",\"extended_support_end\":\"2026-10-13\"},{\"key\":\"2008-r2-sp1\",\"label\":\"2008 R2 SP1\",\"cpe_version\":\"2008\",\"build_prefixes\":[],\"standard_support_end\":\"2015-01-13\",\"extended_support_end\":\"2023-01-10\"}]}]");

const OS_BY_KEY = new Map(OS_PRODUCTS.map((product) => [product.key, product]));

const OS_VERSION_SPLIT = /^(.*\S)\s+(\d[\w.\-]*)$/;

function humanizeOsCode(code: string): string {
  return code.trim().replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
}

function splitOsLabel(label: string): { name: string; version: string | null } {
  const text = label.trim().replace(/\s+/g, ' ');
  if (!text) return { name: '', version: null };
  const match = text.match(OS_VERSION_SPLIT);
  if (!match) return { name: text, version: null };
  return { name: match[1], version: match[2] };
}

function osLabel(name: string, version: string | null | undefined): string {
  const versionText = version?.trim();
  return versionText ? `${name} ${versionText}` : name;
}

function snakeOsLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'os';
}

type Dates = { standard: string | null; extended: string | null };
type Counts = {
  created: number;
  adopted: number;
  versions: number;
  linksCreated: number;
  linksReused: number;
  orphans: number;
};

type Work = {
  code: string;
  label: string;
  deprecated: boolean;
  fromCatalog: boolean;
  fromAsset: boolean;
  dates: Dates;
};

type ResolvedCode = {
  code: string;
  technologyId: string;
  versionId: string | null;
  label: string;
  deprecated: boolean;
  fromCatalog: boolean;
};

const EMPTY: Dates = { standard: null, extended: null };

function day(value: unknown): string | null {
  const text = String(value ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function norm(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

/** The family a new operating system takes: the tenant's `operating_system`, else `other`. */
function familyOf(raw: unknown): string {
  if (!Array.isArray(raw)) return 'operating_system';
  const codes = raw.map((item) => norm((item as { code?: string })?.code)).filter(Boolean);
  return codes.includes('operating_system') ? 'operating_system' : 'other';
}

type HostingOption = { code: string; category?: string; deprecated?: boolean };

const DEFAULT_HOSTING: HostingOption[] = [
  { code: 'on_prem', category: 'on_prem' },
  { code: 'colocation', category: 'on_prem' },
  { code: 'public_cloud', category: 'cloud' },
  { code: 'private_cloud', category: 'cloud' },
  { code: 'saas', category: 'cloud' },
];

function hostingList(raw: unknown): HostingOption[] {
  if (!Array.isArray(raw)) return DEFAULT_HOSTING;
  const list = raw
    .map((item) => ({
      code: norm((item as { code?: string; value?: string })?.code ?? (item as { value?: string })?.value),
      category: (item as { category?: string })?.category,
      deprecated: !!(item as { deprecated?: boolean })?.deprecated,
    }))
    .filter((item) => item.code);
  return list.length ? list : DEFAULT_HOSTING;
}

/** `on_prem` when the tenant still uses it, else the first type in use on premises, else the first in use. */
function hostingOf(raw: unknown): string {
  const list = hostingList(raw);
  const active = list.filter((item) => !item.deprecated);
  if (active.some((item) => item.code === 'on_prem')) return 'on_prem';
  const onPrem = active.find((item) => item.category === 'on_prem' || item.code === 'on_prem' || item.code === 'colocation');
  return onPrem?.code ?? active[0]?.code ?? 'on_prem';
}

function fillDates(current: Dates, incoming: Dates): Dates {
  const standard = current.standard || incoming.standard || null;
  let extended = current.extended || incoming.extended || null;
  if (standard && extended && extended < standard) extended = current.extended;
  return { standard, extended };
}

function shippedCodeFor(catalogKey: string | null, name: string, version: string | null): string | null {
  const versionLabel = (version ?? '').toLowerCase();
  const byKey = SHIPPED_OS_CODES.find((entry) => entry.product === catalogKey && entry.version.toLowerCase() === versionLabel);
  if (byKey) return byKey.code;
  const product = OS_PRODUCTS.find((item) => item.name.toLowerCase() === name.toLowerCase());
  if (!product) return null;
  return SHIPPED_OS_CODES.find((entry) => entry.product === product.key && entry.version.toLowerCase() === versionLabel)?.code ?? null;
}

function assetsSearchFunction(withOperatingSystem: boolean): string {
  const metadata = withOperatingSystem
    ? 'a.kind, a.provider, a.environment, a.operating_system, a.status::text, a.domain, a.cluster, a.region, a.zone'
    : 'a.kind, a.provider, a.environment, a.status::text, a.domain, a.cluster, a.region, a.zone';
  return `
    CREATE OR REPLACE FUNCTION search_index_refresh_assets(p_tenant uuid, p_ids uuid[] DEFAULT NULL)
    RETURNS void AS $fn$
      DELETE FROM search_index si_del
      WHERE si_del.tenant_id = p_tenant
        AND si_del.entity_type = 'assets'
        AND (p_ids IS NULL OR si_del.entity_id = ANY(p_ids))
        AND NOT EXISTS (
          SELECT 1 FROM assets src
          WHERE src.id = si_del.entity_id AND src.tenant_id = p_tenant
        );
      INSERT INTO search_index (
        tenant_id, entity_type, entity_id, ref_prefix, ref_number,
        label, summary, status, extra_json, search_vector, source_updated_at, indexed_at
      )
      SELECT a.tenant_id, 'assets', a.id,
             CASE WHEN a.asset_reference ~* '^AST-[0-9]+$' THEN 'AST' ELSE NULL END,
             CASE WHEN a.asset_reference ~* '^AST-[0-9]+$' THEN NULLIF(regexp_replace(a.asset_reference, '^AST-', '', 'i'), '')::int ELSE NULL END,
             a.name,
             COALESCE(a.fqdn, a.hostname, a.notes),
             a.status::text,
             jsonb_build_object('item_ref', a.asset_reference),
             search_index_tsv('A', CONCAT_WS(' ', a.asset_reference, a.name))
               || search_index_tsv('B', CONCAT_WS(' ', ${metadata}))
               || search_index_tsv('C', CONCAT_WS(' ', a.fqdn, a.hostname, a.notes, array_to_string(COALESCE(a.aliases, '{}'), ' '))),
             a.updated_at,
             now()
      FROM assets a
      WHERE a.tenant_id = p_tenant
        AND (p_ids IS NULL OR a.id = ANY(p_ids))
      ON CONFLICT (tenant_id, entity_type, entity_id) DO UPDATE SET
        ref_prefix = EXCLUDED.ref_prefix,
        ref_number = EXCLUDED.ref_number,
        label = EXCLUDED.label,
        summary = EXCLUDED.summary,
        status = EXCLUDED.status,
        extra_json = EXCLUDED.extra_json,
        search_vector = EXCLUDED.search_vector,
        source_updated_at = EXCLUDED.source_updated_at,
        indexed_at = EXCLUDED.indexed_at;
    $fn$ LANGUAGE sql;
  `;
}

async function columnExists(queryRunner: QueryRunner, table: string, column: string): Promise<boolean> {
  const rows = await queryRunner.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return rows.length > 0;
}

async function nextItemNumber(queryRunner: QueryRunner, tenantId: string): Promise<number> {
  const [row]: Array<{ n: number }> = await queryRunner.query(
    `SELECT GREATEST(
       COALESCE((SELECT next_val FROM item_sequences WHERE tenant_id = $1 AND entity_type = 'technology'), 1),
       COALESCE((SELECT MAX(item_number) + 1 FROM technologies WHERE tenant_id = $1), 1)
     )::int AS n`,
    [tenantId],
  );
  const n = Number(row.n);
  await queryRunner.query(
    `INSERT INTO item_sequences (tenant_id, entity_type, next_val) VALUES ($1, 'technology', $2)
     ON CONFLICT (tenant_id, entity_type) DO UPDATE SET next_val = EXCLUDED.next_val`,
    [tenantId, n + 1],
  );
  return n;
}

function catalogState(product: FrozenProduct): string {
  return JSON.stringify({
    cpe_products: [],
    versions: Object.fromEntries(product.versions.map((version) => [version.key, {
      standard_support_end: version.standard_support_end,
      extended_support_end: version.extended_support_end,
      cpe_version: version.cpe_version,
    }])),
    description: product.description,
  });
}

async function insertVersions(
  queryRunner: QueryRunner,
  tenantId: string,
  technologyId: string,
  product: FrozenProduct,
): Promise<number> {
  const inserted: Array<{ id: string }> = await queryRunner.query(
    `INSERT INTO technology_versions (
       tenant_id, technology_id, label, cpe_version, build_prefixes, standard_support_end, extended_support_end, catalog_key
     )
     SELECT $1, $2, v.label, v.cpe_version,
            ARRAY(SELECT jsonb_array_elements_text(v.build_prefixes)),
            NULLIF(v.standard_support_end, '')::date, NULLIF(v.extended_support_end, '')::date,
            $3 || ':' || v.key
       FROM jsonb_to_recordset($4::jsonb) AS v(
         key text, label text, cpe_version text, build_prefixes jsonb, standard_support_end text, extended_support_end text
       )
     ON CONFLICT (tenant_id, technology_id, lower(label)) DO NOTHING
     RETURNING id`,
    [tenantId, technologyId, product.key, JSON.stringify(product.versions)],
  );
  return inserted.length;
}

/**
 * The shipped product, adopted in SQL from the frozen copy. An existing technology of the same
 * name is kept (family and lifecycle included) and receives the catalog key when it has none
 * or already this one. A technology already adopted does not gain back a version the tenant deleted,
 * except the version the code names, which the caller ensures.
 */
async function adoptProduct(
  queryRunner: QueryRunner,
  tenantId: string,
  product: FrozenProduct,
  family: string,
  hosting: string,
): Promise<{ id: string; name: string; created: boolean; adopted: boolean; versions: number }> {
  const [existing]: Array<{ id: string; name: string; catalog_key: string | null }> = await queryRunner.query(
    `SELECT id, name, catalog_key FROM technologies
      WHERE tenant_id = $1 AND (catalog_key = $2 OR lower(name) = lower($3))
      ORDER BY (catalog_key = $2) DESC NULLS LAST
      LIMIT 1`,
    [tenantId, product.key, product.name],
  );
  if (existing?.catalog_key === product.key) {
    return { id: existing.id, name: existing.name, created: false, adopted: false, versions: 0 };
  }
  if (existing?.catalog_key && existing.catalog_key !== product.key) {
    return { id: existing.id, name: existing.name, created: false, adopted: false, versions: 0 };
  }
  const state = catalogState(product);
  if (existing) {
    await queryRunner.query(
      `UPDATE technologies
          SET catalog_key = $3, editor = COALESCE(editor, $4),
              description = COALESCE(NULLIF(btrim(description), ''), $5),
              catalog_state = $6::jsonb, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, existing.id, product.key, product.editor, product.description, state],
    );
    const versions = await insertVersions(queryRunner, tenantId, existing.id, product);
    return { id: existing.id, name: existing.name, created: false, adopted: true, versions };
  }
  const itemNumber = await nextItemNumber(queryRunner, tenantId);
  const [row]: Array<{ id: string }> = await queryRunner.query(
    `INSERT INTO technologies (
       tenant_id, item_number, name, editor, family, hosting_type, catalog_key, cpe_products, description, catalog_state
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, '{}', $8, $9::jsonb)
     RETURNING id`,
    [tenantId, itemNumber, product.name, product.editor, family, hosting, product.key, product.description, state],
  );
  const versions = await insertVersions(queryRunner, tenantId, row.id, product);
  return { id: row.id, name: product.name, created: true, adopted: true, versions };
}

async function ensureNamed(
  queryRunner: QueryRunner,
  tenantId: string,
  name: string,
  family: string,
  hosting: string,
): Promise<{ id: string; name: string; created: boolean }> {
  const [existing]: Array<{ id: string; name: string }> = await queryRunner.query(
    `SELECT id, name FROM technologies WHERE tenant_id = $1 AND lower(name) = lower($2) LIMIT 1`,
    [tenantId, name],
  );
  if (existing) return { id: existing.id, name: existing.name, created: false };
  const itemNumber = await nextItemNumber(queryRunner, tenantId);
  const [row]: Array<{ id: string; name: string }> = await queryRunner.query(
    `INSERT INTO technologies (tenant_id, item_number, name, family, hosting_type)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name`,
    [tenantId, itemNumber, name, family, hosting],
  );
  return { id: row.id, name: row.name, created: true };
}

async function ensureVersion(
  queryRunner: QueryRunner,
  tenantId: string,
  technologyId: string,
  label: string,
  dates: Dates,
  shipped: { productKey: string; version: FrozenVersion } | null,
): Promise<{ id: string; label: string; created: boolean }> {
  const text = shipped?.version.label ?? label;
  const [found]: Array<{ id: string; label: string; standard: string | null; extended: string | null }> = await queryRunner.query(
    `SELECT id, label,
            to_char(standard_support_end, 'YYYY-MM-DD') AS standard,
            to_char(extended_support_end, 'YYYY-MM-DD') AS extended
       FROM technology_versions
      WHERE tenant_id = $1 AND technology_id = $2 AND lower(label) = lower($3)`,
    [tenantId, technologyId, text],
  );
  if (found) {
    const next = fillDates({ standard: found.standard, extended: found.extended }, dates);
    if (next.standard !== found.standard || next.extended !== found.extended) {
      await queryRunner.query(
        `UPDATE technology_versions
            SET standard_support_end = $3, extended_support_end = $4, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, found.id, next.standard, next.extended],
      );
    }
    return { id: found.id, label: found.label, created: false };
  }
  const version = shipped?.version;
  const [inserted]: Array<{ id: string; label: string }> = await queryRunner.query(
    `INSERT INTO technology_versions (
       tenant_id, technology_id, label, cpe_version, build_prefixes, standard_support_end, extended_support_end, catalog_key
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, label`,
    [
      tenantId, technologyId, text,
      version?.cpe_version ?? null,
      version?.build_prefixes ?? [],
      dates.standard, dates.extended && (!dates.standard || dates.extended >= dates.standard) ? dates.extended : null,
      shipped ? `${shipped.productKey}:${version!.key}` : null,
    ],
  );
  return { id: inserted.id, label: inserted.label, created: true };
}

/** Mark the operating system. Returns true when an existing link was reused. */
async function linkOperatingSystem(
  queryRunner: QueryRunner,
  tenantId: string,
  assetId: string,
  technologyId: string,
  versionId: string | null,
): Promise<boolean> {
  await queryRunner.query(`SELECT id FROM assets WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, assetId]);
  const [marked]: Array<{ id: string; technology_id: string; technology_version_id: string | null }> = await queryRunner.query(
    `SELECT id, technology_id, technology_version_id FROM asset_technologies
      WHERE tenant_id = $1 AND asset_id = $2 AND is_operating_system`,
    [tenantId, assetId],
  );
  if (marked && marked.technology_id === technologyId && marked.technology_version_id === versionId) return true;
  if (marked && marked.technology_id !== technologyId) {
    await queryRunner.query(`DELETE FROM asset_technologies WHERE tenant_id = $1 AND id = $2`, [tenantId, marked.id]);
  } else if (marked) {
    await queryRunner.query(
      `UPDATE asset_technologies SET is_operating_system = false, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, marked.id],
    );
  }
  const [same]: Array<{ id: string }> = await queryRunner.query(
    `SELECT id FROM asset_technologies
      WHERE tenant_id = $1 AND asset_id = $2 AND technology_id = $3 AND technology_version_id IS NOT DISTINCT FROM $4`,
    [tenantId, assetId, technologyId, versionId],
  );
  if (same) {
    await queryRunner.query(
      `UPDATE asset_technologies
          SET is_operating_system = true, source = 'manual', source_ref = NULL, observed_at = NULL, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, same.id],
    );
    return true;
  }
  if (versionId) {
    const [blank]: Array<{ id: string }> = await queryRunner.query(
      `SELECT id FROM asset_technologies
        WHERE tenant_id = $1 AND asset_id = $2 AND technology_id = $3 AND technology_version_id IS NULL
        LIMIT 1`,
      [tenantId, assetId, technologyId],
    );
    if (blank) {
      await queryRunner.query(
        `UPDATE asset_technologies
            SET technology_version_id = $3, is_operating_system = true, source = 'manual', source_ref = NULL, observed_at = NULL, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, blank.id, versionId],
      );
      return true;
    }
  }
  await queryRunner.query(
    `INSERT INTO asset_technologies (
       tenant_id, asset_id, technology_id, technology_version_id, is_operating_system, source
     ) VALUES ($1, $2, $3, $4, true, 'manual')
     ON CONFLICT ON CONSTRAINT asset_technologies_key DO UPDATE
       SET is_operating_system = true, source = 'manual', source_ref = NULL, observed_at = NULL, updated_at = now()`,
    [tenantId, assetId, technologyId, versionId],
  );
  return false;
}

async function migrateTenant(queryRunner: QueryRunner, tenantId: string): Promise<Counts> {
  await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const counts: Counts = { created: 0, adopted: 0, versions: 0, linksCreated: 0, linksReused: 0, orphans: 0 };
  const [tenant]: Array<{ metadata: { it_ops?: Record<string, unknown> } | null }> = await queryRunner.query(
    `SELECT metadata FROM tenants WHERE id = $1`,
    [tenantId],
  );
  const itOps = tenant?.metadata?.it_ops ?? {};
  const settingsRaw = itOps.operating_systems;
  const settingsList = Array.isArray(settingsRaw) ? settingsRaw : null;
  const family = familyOf(itOps.technology_families);
  const hosting = hostingOf(itOps.hosting_types);
  const effective = new Set<string>(
    settingsList
      ? settingsList.map((entry) => norm((entry as { code?: string; value?: string }).code ?? (entry as { value?: string }).value)).filter(Boolean)
      : SHIPPED_OS_CODES.map((entry) => entry.code),
  );

  const works = new Map<string, Work>();
  const add = (code: string, patch: Partial<Work>) => {
    if (!code) return;
    const current = works.get(code) ?? { code, label: '', deprecated: false, fromCatalog: false, fromAsset: false, dates: { ...EMPTY } };
    if (patch.label) current.label = patch.label;
    if (patch.deprecated) current.deprecated = true;
    if (patch.fromCatalog) current.fromCatalog = true;
    if (patch.fromAsset) current.fromAsset = true;
    if (patch.dates) current.dates = patch.dates;
    works.set(code, current);
  };
  if (settingsList) {
    for (const entry of settingsList as Array<Record<string, unknown>>) {
      const code = norm(entry.code ?? entry.value);
      add(code, {
        label: String(entry.label ?? entry.name ?? '').trim(),
        deprecated: !!entry.deprecated,
        fromCatalog: true,
        dates: {
          standard: day(entry.standardSupportEnd ?? entry.standard_support_end),
          extended: day(entry.extendedSupportEnd ?? entry.extended_support_end),
        },
      });
    }
  }
  const assets: Array<{ id: string; code: string }> = await queryRunner.query(
    `SELECT id, lower(btrim(operating_system)) AS code FROM assets
      WHERE tenant_id = $1 AND operating_system IS NOT NULL AND btrim(operating_system) <> ''`,
    [tenantId],
  );
  for (const asset of assets) add(asset.code, { fromAsset: true });

  const configs: Array<{ id: string; metadata_json: Record<string, unknown> | null }> = await queryRunner.query(
    `SELECT id, metadata_json FROM ai_adapter_configs
      WHERE tenant_id = $1 AND provider_kind = 'inventory' AND provider_key = 'netbox'`,
    [tenantId],
  );
  for (const config of configs) {
    const map = (config.metadata_json ?? {}).os_map;
    if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
    for (const value of Object.values(map as Record<string, unknown>)) {
      const text = String(value ?? '').trim();
      if (text && !/\s/.test(text)) add(norm(text), {});
    }
  }

  const createdIds = new Set<string>();
  const resolved = new Map<string, ResolvedCode>();
  const orphans = new Set<string>();
  for (const work of works.values()) {
    const shipped = SHIPPED_BY_CODE.get(work.code) ?? null;
    if (work.fromAsset && !shipped && !effective.has(work.code)) orphans.add(work.code);
    let technologyId: string;
    let technologyName: string;
    let versionLabel: string | null = null;
    let dates = { ...EMPTY };
    let shippedVersion: { productKey: string; version: FrozenVersion } | null = null;
    if (shipped) {
      const product = OS_BY_KEY.get(shipped.product);
      if (!product) continue;
      const applied = await adoptProduct(queryRunner, tenantId, product, family, hosting);
      technologyId = applied.id;
      technologyName = applied.name;
      if (applied.created) {
        counts.created += 1;
        createdIds.add(applied.id);
      }
      if (applied.adopted) counts.adopted += 1;
      counts.versions += applied.versions;
      const version = product.versions.find((item) => item.label.toLowerCase() === shipped.version.toLowerCase());
      versionLabel = version?.label ?? shipped.version;
      if (version) shippedVersion = { productKey: product.key, version };
      dates = fillDates(
        { standard: version?.standard_support_end ?? null, extended: version?.extended_support_end ?? null },
        { standard: shipped.standardSupportEnd, extended: shipped.extendedSupportEnd },
      );
      dates = fillDates(dates, work.dates);
    } else {
      const label = work.label || humanizeOsCode(work.code);
      const split = splitOsLabel(label);
      if (!split.name) continue;
      const row = await ensureNamed(queryRunner, tenantId, split.name, family, hosting);
      technologyId = row.id;
      technologyName = row.name;
      if (row.created) {
        counts.created += 1;
        createdIds.add(row.id);
      }
      versionLabel = split.version;
      dates = work.dates;
    }
    let versionId: string | null = null;
    let storedVersion: string | null = null;
    if (versionLabel) {
      const version = await ensureVersion(queryRunner, tenantId, technologyId, versionLabel, dates, shippedVersion);
      versionId = version.id;
      storedVersion = version.label;
      if (version.created) counts.versions += 1;
    }
    resolved.set(work.code, {
      code: work.code,
      technologyId,
      versionId,
      label: osLabel(technologyName, storedVersion),
      deprecated: work.fromCatalog && work.deprecated,
      fromCatalog: work.fromCatalog,
    });
  }
  counts.orphans = orphans.size;

  for (const asset of assets) {
    const item = resolved.get(asset.code);
    if (!item) continue;
    const reused = await linkOperatingSystem(queryRunner, tenantId, asset.id, item.technologyId, item.versionId);
    if (reused) counts.linksReused += 1;
    else counts.linksCreated += 1;
  }

  const catalogByTechnology = new Map<string, ResolvedCode[]>();
  for (const item of resolved.values()) {
    if (!item.fromCatalog) continue;
    const list = catalogByTechnology.get(item.technologyId) ?? [];
    list.push(item);
    catalogByTechnology.set(item.technologyId, list);
  }
  for (const technologyId of createdIds) {
    const entries = catalogByTechnology.get(technologyId) ?? [];
    if (entries.length === 0 || entries.some((entry) => !entry.deprecated)) continue;
    const own = new Set(entries.map((entry) => entry.versionId).filter((id): id is string => !!id));
    const used: Array<{ technology_version_id: string }> = await queryRunner.query(
      `SELECT DISTINCT technology_version_id FROM asset_technologies
        WHERE tenant_id = $1 AND technology_id = $2 AND technology_version_id IS NOT NULL`,
      [tenantId, technologyId],
    );
    if (used.some((row) => !own.has(row.technology_version_id))) continue;
    await queryRunner.query(
      `UPDATE technologies SET lifecycle = 'retired', updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND lifecycle IS DISTINCT FROM 'retired'`,
      [tenantId, technologyId],
    );
  }

  for (const config of configs) {
    const metadata = { ...(config.metadata_json ?? {}) };
    const map = metadata.os_map;
    if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(map as Record<string, unknown>)) {
      const code = norm(value);
      const item = resolved.get(code);
      if (item && item.label !== value) {
        next[key] = item.label;
        changed = true;
      } else next[key] = value;
    }
    if (!changed) continue;
    metadata.os_map = next;
    await queryRunner.query(
      `UPDATE ai_adapter_configs SET metadata_json = $3::jsonb, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, config.id, JSON.stringify(metadata)],
    );
  }

  await queryRunner.query(
    `UPDATE tenants SET metadata = metadata #- '{it_ops,operating_systems}'
      WHERE id = $1 AND metadata #> '{it_ops,operating_systems}' IS NOT NULL`,
    [tenantId],
  );
  return counts;
}

async function restoreTenant(queryRunner: QueryRunner, tenantId: string): Promise<void> {
  await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const rows: Array<{
    asset_id: string;
    catalog_key: string | null;
    name: string;
    version: string | null;
    standard_support_end: string | null;
    extended_support_end: string | null;
  }> = await queryRunner.query(
    `SELECT a.id AS asset_id, t.catalog_key, t.name, v.label AS version,
            to_char(v.standard_support_end, 'YYYY-MM-DD') AS standard_support_end,
            to_char(v.extended_support_end, 'YYYY-MM-DD') AS extended_support_end
       FROM asset_technologies at
       JOIN assets a ON a.tenant_id = at.tenant_id AND a.id = at.asset_id
       JOIN technologies t ON t.tenant_id = at.tenant_id AND t.id = at.technology_id
       LEFT JOIN technology_versions v ON v.tenant_id = at.tenant_id AND v.id = at.technology_version_id
      WHERE at.tenant_id = $1 AND at.is_operating_system`,
    [tenantId],
  );
  const updates: Array<{ id: string; code: string }> = [];
  const settings: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const label = osLabel(row.name, row.version);
    const code = shippedCodeFor(row.catalog_key, row.name, row.version) ?? snakeOsLabel(label);
    updates.push({ id: row.asset_id, code });
    if (seen.has(code)) continue;
    seen.add(code);
    settings.push({
      code,
      label,
      deprecated: false,
      ...(row.standard_support_end ? { standardSupportEnd: row.standard_support_end } : {}),
      ...(row.extended_support_end ? { extendedSupportEnd: row.extended_support_end } : {}),
    });
  }
  if (updates.length) {
    await queryRunner.query(
      `UPDATE assets a SET operating_system = m.code
         FROM jsonb_to_recordset($2::jsonb) AS m(id uuid, code text)
        WHERE a.tenant_id = $1 AND a.id = m.id`,
      [tenantId, JSON.stringify(updates)],
    );
  }
  await queryRunner.query(
    `UPDATE tenants
        SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{it_ops,operating_systems}', $2::jsonb, true)
      WHERE id = $1`,
    [tenantId, JSON.stringify(settings)],
  );
}

function logLine(tenantId: string, counts: Counts): string {
  return `[migration 1854330000000] tenant ${tenantId}: created=${counts.created} adopted=${counts.adopted}`
    + ` versions=${counts.versions} links_created=${counts.linksCreated} links_reused=${counts.linksReused}`
    + ` orphans=${counts.orphans}`;
}

export class OperatingSystemTechnology1854330000000 implements MigrationInterface {
  name = 'OperatingSystemTechnology1854330000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('asset_technologies')) || !(await queryRunner.hasTable('assets'))) return;
    await queryRunner.query(
      `ALTER TABLE asset_technologies ADD COLUMN IF NOT EXISTS is_operating_system boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_technologies_one_os
         ON asset_technologies (tenant_id, asset_id) WHERE is_operating_system`,
    );
    await queryRunner.query(assetsSearchFunction(false));
    if (!(await columnExists(queryRunner, 'assets', 'operating_system'))) return;

    const tenants: Array<{ id: string }> = await queryRunner.query(`SELECT id FROM tenants ORDER BY id`);
    for (const tenant of tenants) {
      const counts = await migrateTenant(queryRunner, tenant.id);
      const any = counts.created || counts.adopted || counts.versions || counts.linksCreated || counts.linksReused || counts.orphans;
      if (any) console.log(logLine(tenant.id, counts));
    }
    await queryRunner.query(`SELECT set_config('app.current_tenant', '', true)`);
    await queryRunner.query(`ALTER TABLE assets DROP COLUMN IF EXISTS operating_system`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('assets'))) return;
    await queryRunner.query(`ALTER TABLE assets ADD COLUMN IF NOT EXISTS operating_system text NULL`);
    if (await columnExists(queryRunner, 'asset_technologies', 'is_operating_system')) {
      const tenants: Array<{ id: string }> = await queryRunner.query(`SELECT id FROM tenants ORDER BY id`);
      for (const tenant of tenants) await restoreTenant(queryRunner, tenant.id);
      await queryRunner.query(`SELECT set_config('app.current_tenant', '', true)`);
      await queryRunner.query(`DROP INDEX IF EXISTS uq_asset_technologies_one_os`);
      await queryRunner.query(`ALTER TABLE asset_technologies DROP COLUMN IF EXISTS is_operating_system`);
    }
    await queryRunner.query(assetsSearchFunction(true));
  }
}
