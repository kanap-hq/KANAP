/**
 * Plain-language texts for the two vulnerability feeds: why a row exists (the NVD criteria and the
 * publisher's CVE.org blocks of `GET /vulnerabilities/:cveId`), the NVD status of a CVE, and how
 * fresh each feed is (`GET /vulnerabilities/sources`). Pure functions: the texts come from `t`.
 */

type Translate = (key: string, options?: Record<string, unknown>) => string;

export type MatchSource = 'nvd' | 'cve_org';
export type AffectedStatus = 'affected' | 'unaffected' | 'unknown';

/** One NVD bound: an exact version, or a range with optional ends. */
export type NvdBound = {
  exact?: string;
  start?: string;
  start_including?: boolean;
  end?: string;
  end_including?: boolean;
};

export type NvdMatch = { source: 'nvd'; cpe: string; versions: NvdBound[] };

/** One version entry of a publisher block (CVE.org `affected[].versions[]`). */
export type CveOrgVersion = {
  version: string | null;
  status: AffectedStatus | null;
  lessThan: string | null;
  lessThanOrEqual: string | null;
  changes?: Array<{ at: string; status: AffectedStatus }>;
  versionType?: string | null;
};

export type CveOrgMatch = {
  source: 'cve_org';
  vendor: string | null;
  product: string | null;
  cpe: string | null;
  container?: string;
  default_status: AffectedStatus | null;
  /** At most 20 entries. */
  versions: CveOrgVersion[];
  /** Every entry of the block. */
  versions_total: number;
  package_name?: string | null;
  platforms?: string[];
  modules?: string[];
};

export type FeedMatch = NvdMatch | CveOrgMatch;

const K = 'pages.vulnerabilities.feeds';

/** `*`, `-` or nothing: no bound on that side. */
function open(value: string | null | undefined): boolean {
  const text = value?.trim() ?? '';
  return text === '' || text === '*' || text === '-';
}

function nvdBound(bound: NvdBound, t: Translate): string {
  if (bound.exact && !open(bound.exact)) return t(`${K}.why.exact`, { version: bound.exact });
  const hasStart = !open(bound.start);
  const hasEnd = !open(bound.end);
  const start = bound.start;
  const end = bound.end;
  if (hasStart && hasEnd) {
    const key = `${bound.start_including ? 'from' : 'after'}${bound.end_including ? 'ToIncluded' : 'ToExcluded'}`;
    return t(`${K}.why.nvd.${key}`, { start, end });
  }
  if (hasStart) return t(`${K}.why.nvd.${bound.start_including ? 'from' : 'after'}`, { start });
  if (hasEnd) return t(`${K}.why.nvd.${bound.end_including ? 'upToIncluded' : 'before'}`, { end });
  return t(`${K}.why.every`);
}

/** "CPE identifier a:apache:tomcat, versions before 9.0.99; versions from 10.1.1 to 10.1.35 excluded". */
export function describeNvdMatch(match: NvdMatch, t: Translate): string {
  const bounds = (match.versions ?? []).map((bound) => nvdBound(bound, t));
  const cpe = t(`${K}.why.cpe`, { cpe: match.cpe });
  if (bounds.length === 0) return cpe;
  return t(`${K}.why.withVersions`, { subject: cpe, versions: bounds.join(t(`${K}.why.separator`)) });
}

function statusText(status: AffectedStatus, plural: boolean, t: Translate): string {
  return t(`${K}.why.status.${status}`, { count: plural ? 2 : 1 });
}

/** One publisher version entry: its range, then its status and the changes inside the range. */
function cveOrgVersion(entry: CveOrgVersion, t: Translate): string {
  const upper = entry.lessThan ?? entry.lessThanOrEqual;
  const included = entry.lessThan == null && entry.lessThanOrEqual != null;
  let range: string;
  let plural = true;
  if (upper == null) {
    if (open(entry.version)) range = t(`${K}.why.every`);
    else {
      range = t(`${K}.why.exact`, { version: entry.version });
      plural = false;
    }
  } else if (open(upper)) {
    range = open(entry.version) ? t(`${K}.why.every`) : t(`${K}.why.org.andLater`, { start: entry.version });
  } else if (open(entry.version) || entry.version === '0') {
    range = t(`${K}.why.org.${included ? 'upTo' : 'before'}`, { end: upper });
  } else {
    range = t(`${K}.why.org.${included ? 'range' : 'rangeExcluded'}`, { start: entry.version, end: upper });
  }
  const parts = [entry.status ? t(`${K}.why.org.entry`, { range, status: statusText(entry.status, plural, t) }) : range];
  for (const change of entry.changes ?? []) {
    parts.push(t(`${K}.why.org.change`, { at: change.at, status: statusText(change.status, true, t) }));
  }
  return parts.join(', ');
}

/**
 * "Apache Software Foundation · Apache Tomcat: versions 9.0.0.M1 to 9.0.98 affected; versions 3 to
 * 8.5.0 status unknown; all other versions not affected", then the package, platforms and modules,
 * and the entries past the 20 the answer carries.
 */
export function describeCveOrgMatch(match: CveOrgMatch, t: Translate): string {
  const separator = t(`${K}.why.separator`);
  const name = [match.vendor, match.product].filter((part): part is string => Boolean(part && part.trim())).join(' · ')
    || t(`${K}.why.org.unnamed`);
  const versions = (match.versions ?? []).map((entry) => cveOrgVersion(entry, t));
  const hidden = Math.max((match.versions_total ?? 0) - (match.versions ?? []).length, 0);
  if (hidden > 0) versions.push(t(`${K}.why.org.more`, { count: hidden }));
  if (match.default_status) versions.push(t(`${K}.why.org.default`, { status: statusText(match.default_status, true, t) }));
  const extras: string[] = [];
  if (match.package_name) extras.push(t(`${K}.why.org.package`, { name: match.package_name }));
  if (match.platforms && match.platforms.length > 0) extras.push(t(`${K}.why.org.platforms`, { list: match.platforms.join(', ') }));
  if (match.modules && match.modules.length > 0) extras.push(t(`${K}.why.org.modules`, { list: match.modules.join(', ') }));
  const body = [...versions, ...extras];
  if (body.length === 0) return name;
  return t(`${K}.why.withVersions`, { subject: name, versions: body.join(separator) });
}

export function describeMatch(match: FeedMatch, t: Translate): string {
  return match.source === 'nvd' ? describeNvdMatch(match, t) : describeCveOrgMatch(match, t);
}

/** The NVD status of a CVE in five words: analyzed, pending, not analyzed, rejected, absent. */
export type NvdState = 'analyzed' | 'pending' | 'deferred' | 'rejected' | 'absent';

export function nvdState(status: string | null | undefined): NvdState {
  switch ((status ?? '').trim().toLowerCase()) {
    case 'analyzed':
    case 'modified':
      return 'analyzed';
    case 'awaiting analysis':
    case 'undergoing analysis':
    case 'received':
      return 'pending';
    case 'deferred':
      return 'deferred';
    case 'rejected':
      return 'rejected';
    case '':
      return 'absent';
    default:
      // A status the NVD may add later: still a row of the NVD, waiting for its analysis.
      return 'pending';
  }
}

/** One feed of `GET /vulnerabilities/sources`. */
export type FeedSourceStatus = {
  source: MatchSource;
  last_success_at: string | null;
  last_attempt_at: string | null;
  failing: boolean;
  enabled: boolean;
};

const DAY = 24 * 60 * 60 * 1000;
/** A feed not read for longer than this warns. */
export const STALE_AFTER_DAYS = 3;

export type FeedAge = {
  source: MatchSource;
  /** The last success, or null when the feed was never read. */
  readAt: Date | null;
  /** The warning of this feed, if any. */
  warning: null | { kind: 'failing' } | { kind: 'stale'; days: number };
};

/** The feeds that are on, with the age of their data and their warning. */
export function feedAges(items: FeedSourceStatus[] | null | undefined, now: Date = new Date()): FeedAge[] {
  return (items ?? [])
    .filter((item) => item && item.enabled && (item.source === 'nvd' || item.source === 'cve_org'))
    .map((item) => {
      const parsed = item.last_success_at ? new Date(item.last_success_at) : null;
      const readAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
      let warning: FeedAge['warning'] = null;
      if (item.failing) warning = { kind: 'failing' };
      else if (readAt && now.getTime() - readAt.getTime() > STALE_AFTER_DAYS * DAY) {
        warning = { kind: 'stale', days: Math.floor((now.getTime() - readAt.getTime()) / DAY) };
      }
      return { source: item.source, readAt, warning };
    });
}
