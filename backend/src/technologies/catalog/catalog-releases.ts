import { catalogCveNames, type CveName } from '../../vulnerabilities/cve-affected-rules';
import type { CatalogProduct, CatalogVersion } from './technology-catalog.service';

/**
 * The release cycles of endoflife.date (API v1, `GET /products/{product}`, `result.releases`) as the
 * catalog keeps them: the same rules as `scripts/technologies/build-catalog.mjs` (`versionsOf`,
 * `cleanLabel`, `cpeVersionOf`), which builds the shipped catalog. The living catalog (lot C4) reads
 * the cycles of the adopted entries with these rules between two KANAP versions. A spec checks that
 * `cpeVersionOf` gives back the `cpe_version` of every shipped version.
 */

/** Versions kept per product: the newest released ones, at most this many. */
export const MAX_VERSIONS = 8;
/** Versions whose last support ended more than this many years ago are left out. */
export const ENDED_YEARS_KEPT = 4;
/**
 * Operating systems (the entries of `SUPPORT_RULES`) in place of the two rules above: every
 * version whose last support (standard, extended or end of life) ends on this day or later,
 * however many. Servers run old systems long after their support ended, and KANAP must name them
 * to flag them. Twin of `OS_SUPPORT_ENDED_SINCE` in `scripts/technologies/build-catalog.mjs`.
 */
export const OS_SUPPORT_ENDED_SINCE = '2010-01-01';
/** Release cycles read per product at most: an answer with more is cut. */
export const MAX_RELEASES = 500;
/** Raw names and labels are cut to this length before they are read. */
const RAW_TEXT_MAX = 200;

/** One release cycle of endoflife.date, as far as the catalog reads it. */
export type EndoflifeRelease = {
  name?: unknown;
  label?: unknown;
  releaseDate?: unknown;
  eoasFrom?: unknown;
  eolFrom?: unknown;
  eoesFrom?: unknown;
  isLts?: unknown;
};

type CpeVersionRule = {
  fromLabel?: boolean;
  patterns?: Array<[RegExp, string]>;
  /**
   * One ASA or NX-OS version: lower case, parentheses escaped (`9.16(4)` → `9.16\(4\)`).
   * A label that is not a single version stays on the default rule.
   */
  escapedParens?: boolean;
  /** A train label `4.36.x` or `15.x` gives `4.36` or `15`. Other labels use the default rule. */
  stripTrain?: boolean;
  /**
   * The CPE product the NVD gives each release of the entry, `{year}` standing for the year that
   * starts its label: SQL Server since 2024 (`a:microsoft:sql_server_2022`) and Windows Server
   * (`o:microsoft:windows_server_2022`). The matching applies such a product to the versions whose
   * label starts with that year (`productRelease` in `vulnerabilities/vulnerability-rules.ts`).
   * A release the living catalog adds receives it. `productPerReleaseFrom` leaves earlier years out
   * (Windows 2000: the NVD product is `windows_2000`, not `windows_server_2000`).
   */
  productPerRelease?: string;
  productPerReleaseFrom?: number;
  /**
   * Leading numeric segments the matching compares for this entry (`VERSION_PRECISION` in
   * `vulnerabilities/vulnerability-rules.ts`). The NVD names the branch: `9.0` is the whole major,
   * `22.04` the whole Ubuntu `YY.MM`. A version typed `9.4` or `22.04.3 LTS` still meets it.
   */
  matchSegments?: number;
};

/**
 * The `cpeVersion` and `cpeVersions` of the script's PRODUCTS, by catalog key: the entries whose
 * labels need a rule of their own to give the NVD version, and the entries with one CPE product
 * per release.
 */
const CPE_VERSION_RULES: Record<string, CpeVersionRule> = {
  'oracle-database': { fromLabel: true },
  msexchange: { patterns: [[/^subscription edition\b/i, '15.2']] },
  mssqlserver: { productPerRelease: 'a:microsoft:sql_server_{year}' },
  'windows-server': { productPerRelease: 'o:microsoft:windows_server_{year}', productPerReleaseFrom: 2003 },
  // Matched on the branch the NVD publishes. Twin of `VERSION_PRECISION`.
  rhel: { matchSegments: 1 },
  debian: { matchSegments: 1 },
  'oracle-linux': { matchSegments: 1 },
  almalinux: { matchSegments: 1 },
  'rocky-linux': { matchSegments: 1 },
  centos: { matchSegments: 1 },
  ubuntu: { matchSegments: 2 },
  sles: { matchSegments: 1 },
  // KANAP-maintained products. Twin of `cpeVersion` / `cpeVersions` in build-catalog.mjs.
  'check-point-gaia': { fromLabel: true },
  'cisco-asa': { escapedParens: true },
  'cisco-nx-os': { escapedParens: true },
  'ivanti-connect-secure': { stripTrain: true, patterns: [[/^9\.1R\d+$/i, '9.1']] },
  'arista-eos': { stripTrain: true },
  'oracle-weblogic': { stripTrain: true },
  'ibm-websphere': { stripTrain: true },
};

/** Leading segments the matching compares for this catalog entry, or null when it compares in full. */
export function versionPrecisionOf(catalogKey: string): number | null {
  return CPE_VERSION_RULES[catalogKey]?.matchSegments ?? null;
}

/**
 * How an operating system reads the support dates of endoflife.date, so that they keep the meaning
 * of the former operating-system catalog of the IT settings. `eol_then_paid` (Ubuntu, RHEL and
 * its rebuilds, SLES): standard support ends with the security fixes (`eolFrom`), extended support is
 * the paid extension when published (`eoesFrom`: ESM, ELS, LTSS). `active_then_eol` (Windows Server,
 * Debian): standard is the end of mainstream or regular security support, extended the end of
 * extended support or of Debian LTS (`eolFrom`; the paid ESU and ELTS are left out). The twin of `SUPPORT_RULES` in
 * `scripts/technologies/build-catalog.mjs`.
 */
export const SUPPORT_RULES: Record<string, 'eol_then_paid' | 'active_then_eol'> = {
  ubuntu: 'eol_then_paid',
  rhel: 'eol_then_paid',
  debian: 'active_then_eol',
  sles: 'eol_then_paid',
  'rocky-linux': 'eol_then_paid',
  almalinux: 'eol_then_paid',
  'oracle-linux': 'eol_then_paid',
  centos: 'eol_then_paid',
  'windows-server': 'active_then_eol',
};

/**
 * The standard and extended support ends of a release. Other products: standard is the end of
 * active support when the product has one, else the end of life; extended is the paid extension
 * when published, else the end of life after an active support. Extended is null when it is not
 * after standard.
 */
export function supportDates(
  catalogKey: string,
  eoas: string | null,
  eol: string | null,
  eoes: string | null,
): { standard: string | null; extended: string | null } {
  const rule = SUPPORT_RULES[catalogKey];
  let standard: string | null;
  let extended: string | null;
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

/** A release cycle as an operating-system rule reads it: its name, and its label cut to 200 characters. */
type OsRelease = { name: string; label: string | null; isLts: boolean };

/**
 * The release cycles an operating system keeps (`keep`) and the label it stores (`label`), so that
 * the labels match the former IT settings catalog and the operating-system codes (`2012 R2`,
 * `22.04 LTS`, `12 (Bookworm)`, `15 SP5`). Twins of `keepRelease` and `versionLabel` of the
 * script's PRODUCTS. Windows Server: the long-term releases only (the semi-annual `-sac` and annual
 * `-ac` channels are left out), the service pack dropped from the label (the newest service pack
 * comes first and takes it). Ubuntu: the LTS releases only. SLES: endoflife.date names a service
 * pack `15.5`, stored `15 SP5`, and `15.0` is `15`.
 */
const OS_RELEASE_RULES: Record<string, { keep?: (release: OsRelease) => boolean; label?: (release: OsRelease) => string }> = {
  'windows-server': {
    keep: (release) => !/-(sac|ac)$/i.test(release.name),
    label: (release) => {
      const cleaned = cleanLabel(release.label, release.name);
      return cleaned.replace(/^Windows Server\s+/i, '').replace(/\s+SP\d+$/i, '') || cleaned;
    },
  },
  ubuntu: {
    keep: (release) => release.isLts,
    label: (release) => `${release.name} LTS`,
  },
  debian: {
    // "12 (Bookworm)" stays, parentheses included.
    label: (release) => (release.label ?? '').replace(/\s+/g, ' ').trim() || release.name,
  },
  sles: {
    label: (release) => {
      const match = /^(\d+)\.(\d+)$/.exec(release.name);
      if (match) return match[2] === '0' ? match[1] : `${match[1]} SP${Number(match[2])}`;
      return cleanLabel(release.label, release.name);
    },
  },
};

/** The CPE product of the release `label` of an entry with one product per release, or null. */
export function releaseProduct(catalogKey: string, label: string): string | null {
  const rule = CPE_VERSION_RULES[catalogKey];
  const year = /^((?:19|20)\d{2})(?!\d)/.exec(String(label ?? '').trim())?.[1];
  if (!rule?.productPerRelease || !year) return null;
  if (rule.productPerReleaseFrom != null && Number(year) < rule.productPerReleaseFrom) return null;
  return rule.productPerRelease.replace('{year}', year);
}

const LINE_BREAK = /[\n\r\u2028\u2029]/;

/**
 * Each `open … close` span on one line (the nearest `close`) replaced by a space, as the regular
 * expressions of the script's `cleanLabel` do once the spaces are collapsed, in linear time: those
 * expressions are quadratic on a long label.
 */
function dropSpans(text: string, open: string, close: string): string {
  const next = new Array<number>(text.length + 1).fill(-1);
  for (let i = text.length - 1; i >= 0; i -= 1) {
    next[i] = text[i] === close ? i : LINE_BREAK.test(text[i]) ? -1 : next[i + 1];
  }
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const end = text[i] === open ? next[i + 1] : -1;
    if (end >= 0) {
      out += ' ';
      i = end;
    } else {
      out += text[i];
    }
  }
  return out;
}

/** "2022 'Dallas'", "24 (LTS)" → "2022", "24" (`cleanLabel` of the script, in linear time). */
export function cleanLabel(label: unknown, name: unknown): string {
  const text = dropSpans(dropSpans(String(label ?? name ?? ''), '(', ')'), "'", "'").replace(/\s+/g, ' ').trim();
  return text || String(name);
}

/** One version whose parentheses the NVD escapes (`9.16(4.51)` → `9.16\(4.51\)`), or null. */
function escapedParensVersion(text: string): string | null {
  const lower = text.toLowerCase();
  if (!/^\d+(?:\.\d+)*(?:\([0-9a-z]+\)|[a-z]+\d*)+$/.test(lower)) return null;
  return lower.replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** The NVD version of a release label (`cpeVersionOf` of the script): null when the label is the version. */
export function cpeVersionOf(label: string, catalogKey: string): string | null {
  const text = String(label ?? '').trim();
  const rule = CPE_VERSION_RULES[catalogKey];
  if (rule?.fromLabel) return text.toLowerCase() || null;
  for (const [pattern, version] of rule?.patterns ?? []) if (pattern.test(text)) return version;
  if (rule?.escapedParens) {
    const escaped = escapedParensVersion(text);
    if (escaped) return escaped;
  }
  if (rule?.stripTrain) {
    const train = /^(\d+(?:\.\d+)*)\.x$/i.exec(text);
    if (train) return train[1];
  }
  if (/^v?\d+(\.\d+)*[a-z]*$/i.test(text)) return null;
  return text.split(/\s+/).find((token) => /^\d+(\.\d+)*$/.test(token)) ?? null;
}

/** A real day of the calendar between 1990 and 2100 (`2031-02-30` is not one), or null. */
export function realDay(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, dayOfMonth] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1990 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, dayOfMonth));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === dayOfMonth ? value : null;
}

const day = realDay;

/**
 * The versions of an entry from its release cycles (`versionsOf` of the script): released by
 * `today`, the newest first, at most `MAX_VERSIONS`, none whose last support ended more than
 * `ENDED_YEARS_KEPT` years ago, one per label and per key. An operating system keeps every version
 * whose last support ends on `OS_SUPPORT_ENDED_SINCE` or later, with its `OS_RELEASE_RULES`.
 *
 * What a live answer may hold is checked here, before anything reaches the cache: a cycle whose
 * name is not a text of 1 to 100 characters without surrounding spaces, whose label is empty or
 * over 100 characters once cleaned, or whose release or support dates are not real days (null
 * stays unknown) is left out and given to `onReject`. At most `MAX_RELEASES` cycles are read; names and labels are cut to 200
 * characters before they are cleaned.
 */
export function versionsOfReleases(
  releases: EndoflifeRelease[],
  today: string,
  catalogKey: string,
  onReject: (reason: string) => void = () => undefined,
): CatalogVersion[] {
  // SUPPORT_RULES names every operating system of the catalog (the spec checks it).
  const os = Object.prototype.hasOwnProperty.call(SUPPORT_RULES, catalogKey);
  const osRules = os ? OS_RELEASE_RULES[catalogKey] : undefined;
  const cutoff = os ? OS_SUPPORT_ENDED_SINCE : `${Number(today.slice(0, 4)) - ENDED_YEARS_KEPT}${today.slice(4)}`;
  const out: CatalogVersion[] = [];
  const seen = new Set<string>();
  const seenKeys = new Set<string>();
  if (releases.length > MAX_RELEASES) onReject(`${releases.length - MAX_RELEASES} release cycle(s) beyond the first ${MAX_RELEASES} ignored`);
  const sorted = releases
    .slice(0, MAX_RELEASES)
    .filter((release) => release && typeof release === 'object')
    .sort((a, b) => String(b.releaseDate ?? '').slice(0, 20).localeCompare(String(a.releaseDate ?? '').slice(0, 20)));
  for (const release of sorted) {
    const rawName = typeof release.name === 'string' ? release.name.slice(0, RAW_TEXT_MAX) : null;
    if (rawName === null || !rawName.trim() || rawName !== rawName.trim() || rawName.length > 100) {
      onReject(`a release cycle with an unusable name (${JSON.stringify(String(release.name ?? '')).slice(0, 60)})`);
      continue;
    }
    const releaseDate = day(release.releaseDate);
    if (!releaseDate) {
      if (release.releaseDate !== null && release.releaseDate !== undefined) onReject(`${rawName}: release date ${JSON.stringify(release.releaseDate).slice(0, 40)} is not a real day`);
      continue;
    }
    if (releaseDate > today) continue;
    const badDate = (['eoasFrom', 'eolFrom', 'eoesFrom'] as const).find((field) => {
      const value = release[field];
      return value !== null && value !== undefined && typeof value !== 'boolean' && !day(value);
    });
    if (badDate) {
      onReject(`${rawName}: ${badDate} ${JSON.stringify(release[badDate]).slice(0, 40)} is not a real day`);
      continue;
    }
    const eoas = day(release.eoasFrom);
    const eol = day(release.eolFrom);
    const eoes = day(release.eoesFrom);
    const lastEnd = [eoas, eol, eoes].filter((d): d is string => !!d).sort().at(-1) ?? null;
    if (lastEnd && lastEnd < cutoff) continue;
    const rawLabel = typeof release.label === 'string' ? release.label.slice(0, RAW_TEXT_MAX) : null;
    const osRelease: OsRelease = { name: rawName, label: rawLabel, isLts: release.isLts === true };
    if (osRules?.keep && !osRules.keep(osRelease)) continue;
    const label = osRules?.label ? osRules.label(osRelease) : cleanLabel(rawLabel, rawName);
    if (!label || label.length > 100) {
      onReject(`${rawName}: label ${JSON.stringify(rawLabel ?? '').slice(0, 60)} is empty or too long once cleaned`);
      continue;
    }
    if (seen.has(label.toLowerCase()) || seenKeys.has(rawName)) continue;
    seen.add(label.toLowerCase());
    seenKeys.add(rawName);
    const { standard, extended } = supportDates(catalogKey, eoas, eol, eoes);
    const name = rawName;
    out.push({
      key: name,
      label,
      cpe_version: cpeVersionOf(label, catalogKey),
      build_prefixes: name !== label && /^\d+(\.\d+)*$/.test(name) ? [name] : [],
      release_date: releaseDate,
      standard_support_end: standard,
      extended_support_end: extended === standard ? null : extended,
    });
    if (!os && out.length >= MAX_VERSIONS) break;
  }
  return out;
}

/**
 * The versions of an entry as the living catalog offers them: the shipped ones, with the dates
 * endoflife.date publishes now, plus the cycles it published since (`live`). A shipped version
 * keeps its label, `cpe_version` and build prefixes, which the script checked; a version the live
 * list no longer names stays as shipped. Newest first, one per label. Without `live`, the shipped
 * versions.
 */
export function mergeVersions(shipped: readonly CatalogVersion[], live: readonly CatalogVersion[] | null): CatalogVersion[] {
  if (!live) return [...shipped];
  const liveByKey = new Map(live.map((v) => [v.key, v]));
  const shippedKeys = new Set(shipped.map((v) => v.key));
  const merged: CatalogVersion[] = shipped.map((v) => {
    const fresh = liveByKey.get(v.key);
    return fresh ? { ...v, standard_support_end: fresh.standard_support_end, extended_support_end: fresh.extended_support_end } : { ...v };
  });
  const labels = new Set(merged.map((v) => v.label.toLowerCase()));
  for (const v of live) {
    if (shippedKeys.has(v.key) || labels.has(v.label.toLowerCase())) continue;
    labels.add(v.label.toLowerCase());
    merged.push({ ...v });
  }
  return merged.sort((a, b) => String(b.release_date ?? '').localeCompare(String(a.release_date ?? '')) || a.key.localeCompare(b.key));
}

/**
 * The entry with its versions merged (`mergeVersions`); a release the cache adds to an entry with
 * one CPE product per release brings its product (`releaseProduct`).
 */
export function mergeProduct(product: CatalogProduct, live: readonly CatalogVersion[] | null): CatalogProduct {
  if (!live) return product;
  const versions = mergeVersions(product.versions, live);
  const shippedKeys = new Set(product.versions.map((v) => v.key));
  const added = versions
    .filter((v) => !shippedKeys.has(v.key))
    .map((v) => releaseProduct(product.key, v.label))
    .filter((p): p is string => !!p);
  const cpe_products = added.length ? Array.from(new Set([...product.cpe_products, ...added])).sort() : product.cpe_products;
  return { ...product, cpe_products, versions };
}

/**
 * Whether a version read back from the cache can be written as it stands: key and label of 1 to
 * 100 characters, real days, a `cpe_version` of at most 100 characters, build prefixes as texts.
 * The cache holds only what `versionsOfReleases` kept; this guards what an older KANAP or a hand
 * wrote there, so that an adoption or a sync never fails on it.
 */
export function validCatalogVersion(value: unknown): value is CatalogVersion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const text = (x: unknown) => typeof x === 'string' && x.trim().length > 0 && x.length <= 100;
  const date = (x: unknown) => x === null || x === undefined || realDay(x) !== null;
  return text(v.key) && text(v.label) && (v.label as string) === (v.label as string).trim()
    && (v.cpe_version === null || v.cpe_version === undefined || text(v.cpe_version))
    && Array.isArray(v.build_prefixes) && v.build_prefixes.every((p) => typeof p === 'string' && p.length <= 100)
    && date(v.release_date) && date(v.standard_support_end) && date(v.extended_support_end)
    && !(v.standard_support_end && v.extended_support_end && (v.extended_support_end as string) < (v.standard_support_end as string));
}

/** The endoflife.date product of an entry, read from its `source_url`; null for an entry written by hand. */
export function endoflifeSlug(product: CatalogProduct): string | null {
  const match = /^https:\/\/endoflife\.date\/([a-z0-9._-]+)$/i.exec(product.source_url ?? '');
  return match ? match[1] : null;
}

/** The values the catalog writes on a version and follows afterwards. */
export type CatalogVersionValues = {
  standard_support_end: string | null;
  extended_support_end: string | null;
  cpe_version: string | null;
};

/** Identifiers compared and stored without case, once each, in order. */
export function lowerSorted(ids: readonly string[]): string[] {
  return Array.from(new Set(ids.map((id) => id.toLowerCase()))).sort();
}

/**
 * `technologies.catalog_state`: what the catalog has given a technology. `cpe_products`: the
 * identifiers it offers, including one the cache added. One the tenant removed stays here until
 * it has been seen leaving the shipped file, so it is not offered again. One the shipped file
 * withdrew leaves, and is added again if the catalog offers it later. `shipped_cpe`: the
 * identifiers the shipped file listed at the last pass, in lower case. Absent on a state written
 * before that field: the next pass records the current shipped file and withdraws nothing.
 * `cpe_written`: the identifiers the catalog itself wrote and the tenant still holds, lower case.
 * Absent: none, so nothing is withdrawn until the catalog writes one. An identifier the tenant
 * typed first, or held before an adoption, is not in this list.
 * `cve_names`, `shipped_cve_names` and `cve_names_written` follow the same rules for CVE.org
 * names, compared by normalized vendor, product and version. A state without `shipped_cve_names`
 * records the current shipped file and withdraws nothing. A state without `cve_names_written`
 * withdraws nothing. An empty name list is a normal file and does withdraw the names that rule
 * names. `versions`: per version key, the values it last wrote; a key present was offered once (a
 * version the tenant deleted is not created again). `description`: the short description the
 * catalog last wrote; absent or null while it wrote none. `description_language`: the language of
 * that text. A description follows the catalog when the text in that same language changes and the
 * technology still holds the same characters. The state records the new text only when the update
 * changes the row. A change of the tenant's language rewrites nothing. Absent: the language whose
 * catalog text equals `description` is recorded, and nothing is rewritten when none equals it.
 */
export type CatalogState = {
  cpe_products: string[];
  versions: Record<string, CatalogVersionValues>;
  description?: string | null;
  /** Language of `description`. Absent: inferred from the catalog text, or left alone. */
  description_language?: 'en' | 'fr' | 'de' | 'es';
  /** Identifiers of the shipped file at the last pass, lower case. Absent: not known yet. */
  shipped_cpe?: string[];
  /** Identifiers the catalog wrote and the tenant still holds, lower case. Absent: none. */
  cpe_written?: string[];
  /** CVE.org names the catalog offers. Absent on a state written before the field. */
  cve_names?: CveName[];
  /** Names of the shipped file at the last pass. Absent: the next pass withdraws nothing. */
  shipped_cve_names?: CveName[];
  /** Names the catalog wrote and the tenant still holds. Absent: nothing is withdrawn. */
  cve_names_written?: CveName[];
};

export function valuesOf(version: CatalogVersion): CatalogVersionValues {
  return {
    standard_support_end: version.standard_support_end ?? null,
    extended_support_end: version.extended_support_end ?? null,
    cpe_version: version.cpe_version ?? null,
  };
}

/** The state of a technology that has just received everything `product` offers. */
export function offeredState(product: CatalogProduct): CatalogState {
  return {
    cpe_products: [...product.cpe_products].sort(),
    cve_names: catalogCveNames(product.cve_names ?? null),
    versions: Object.fromEntries(product.versions.map((v) => [v.key, valuesOf(v)])),
  };
}
