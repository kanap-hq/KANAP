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
};

type CpeVersionRule = {
  fromLabel?: boolean;
  patterns?: Array<[RegExp, string]>;
  /**
   * The CPE product the NVD gives each release of the entry, `{year}` standing for the year that
   * starts its label: SQL Server since 2024 (`a:microsoft:sql_server_2022`; the matching applies
   * such a product to the versions whose label starts with that year, `productRelease` in
   * `vulnerabilities/vulnerability-rules.ts`). A release the living catalog adds receives it.
   */
  productPerRelease?: string;
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
};

/** The CPE product of the release `label` of an entry with one product per release, or null. */
export function releaseProduct(catalogKey: string, label: string): string | null {
  const template = CPE_VERSION_RULES[catalogKey]?.productPerRelease;
  const year = /^((?:19|20)\d{2})(?!\d)/.exec(String(label ?? '').trim())?.[1];
  return template && year ? template.replace('{year}', year) : null;
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

/** The NVD version of a release label (`cpeVersionOf` of the script): null when the label is the version. */
export function cpeVersionOf(label: string, catalogKey: string): string | null {
  const text = String(label ?? '').trim();
  const rule = CPE_VERSION_RULES[catalogKey];
  if (rule?.fromLabel) return text.toLowerCase() || null;
  for (const [pattern, version] of rule?.patterns ?? []) if (pattern.test(text)) return version;
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
 * `ENDED_YEARS_KEPT` years ago, one per label and per key.
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
  const cutoff = `${Number(today.slice(0, 4)) - ENDED_YEARS_KEPT}${today.slice(4)}`;
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
    const label = cleanLabel(rawLabel, rawName);
    if (!label || label.length > 100) {
      onReject(`${rawName}: label ${JSON.stringify(rawLabel ?? '').slice(0, 60)} is empty or too long once cleaned`);
      continue;
    }
    if (seen.has(label.toLowerCase()) || seenKeys.has(rawName)) continue;
    seen.add(label.toLowerCase());
    seenKeys.add(rawName);
    // Standard support: the end of active support when the product has one, else the end of life.
    // Extended: the paid extension when published, else the end of life after an active support.
    const standard = eoas ?? eol;
    let extended = eoes ?? (eoas ? eol : null);
    if (standard && extended && extended < standard) extended = null;
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
    if (out.length >= MAX_VERSIONS) break;
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

/**
 * `technologies.catalog_state`: what the catalog has given a technology. `cpe_products`: the
 * identifiers it offered (one the tenant removed is not offered again). `versions`: per version
 * key, the values it last wrote; a key present was offered once (a version the tenant deleted is
 * not created again). `description`: the short description the catalog wrote on the technology;
 * absent or null while it wrote none, so an empty description is filled once and never again.
 */
export type CatalogState = {
  cpe_products: string[];
  versions: Record<string, CatalogVersionValues>;
  description?: string | null;
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
    versions: Object.fromEntries(product.versions.map((v) => [v.key, valuesOf(v)])),
  };
}
