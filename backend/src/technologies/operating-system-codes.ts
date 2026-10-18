/**
 * The 19 operating-system codes the IT settings used to ship (`defaultOperatingSystems` in
 * `it-ops-settings.service.ts`), and the product and version they become.
 *
 * The migration `1854330000000` carries its own copy of this table: a migration does not import
 * application code. `operating-system-codes.spec.ts` fails when the two copies differ.
 * `standardSupportEnd` and `extendedSupportEnd` are the dates that catalog stored. They fill a
 * version whose dates are still empty when the shipped technology catalog has none. When the
 * shipped catalog has a date, that date wins.
 */

export type OperatingSystemCode = {
  code: string;
  /** Key of the shipped technology catalog (`technologies.catalog.json`). */
  product: string;
  /** Version label stored on that product, compared without case. */
  version: string;
  standardSupportEnd: string;
  extendedSupportEnd: string;
};

export const OPERATING_SYSTEM_CODES: readonly OperatingSystemCode[] = [
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

const BY_CODE = new Map(OPERATING_SYSTEM_CODES.map((entry) => [entry.code, entry]));

/** The shipped entry for `code` (without case), or null. */
export function shippedOperatingSystemCode(code: string): OperatingSystemCode | null {
  return BY_CODE.get(code.trim().toLowerCase()) ?? null;
}

/**
 * A last token that starts with a digit is the version (`VMware ESXi 8.0` → `VMware ESXi` / `8.0`,
 * `FortiOS 7.4` → `FortiOS` / `7.4`). Otherwise the whole label is the technology (`Cisco Meraki`).
 * `Ubuntu 22.04 LTS` does not split: the last token is `LTS`. The catalog prefix does that one.
 */
export const OPERATING_SYSTEM_VERSION_SPLIT = /^(.*\S)\s+(\d[\w.\-]*)$/;

export function splitOperatingSystemLabel(label: string): { name: string; version: string | null } {
  const text = label.trim().replace(/\s+/g, ' ');
  if (!text) return { name: '', version: null };
  const match = text.match(OPERATING_SYSTEM_VERSION_SPLIT);
  if (!match) return { name: text, version: null };
  return { name: match[1], version: match[2] };
}

/** `foo_bar_2` → `foo bar 2`. A label that is already words is left as it is, underscores aside. */
export function humanizeOperatingSystemCode(code: string): string {
  return code.trim().replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The readable operating system: `Windows Server 2019`, or the technology name when it has no version. */
export function operatingSystemLabel(name: string, version: string | null | undefined): string {
  const versionText = version?.trim();
  return versionText ? `${name} ${versionText}` : name;
}

/** `Windows Server 2019` → `windows_server_2019`. Used when a migration rolls back and no shipped code matches. */
export function snakeCaseOperatingSystemLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'os';
}

const ASSET_ALIAS = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The readable operating system of one asset, as a scalar subquery. The partial unique index
 * guarantees one marked link. `alias` is the assets table in the outer query (`a`).
 * Same text as `operatingSystemLabel`: the technology name, then the version when it has one.
 */
export function operatingSystemLabelSql(assetAlias = 'a'): string {
  if (!ASSET_ALIAS.test(assetAlias)) throw new Error(`Unsafe asset alias: ${assetAlias}`);
  const a = assetAlias;
  return `(SELECT CASE WHEN v.label IS NULL OR btrim(v.label) = '' THEN t.name ELSE t.name || ' ' || v.label END
     FROM asset_technologies at
     JOIN technologies t ON t.tenant_id = at.tenant_id AND t.id = at.technology_id
     LEFT JOIN technology_versions v ON v.tenant_id = at.tenant_id AND v.id = at.technology_version_id
    WHERE at.tenant_id = ${a}.tenant_id AND at.asset_id = ${a}.id AND at.is_operating_system
    LIMIT 1)`;
}
