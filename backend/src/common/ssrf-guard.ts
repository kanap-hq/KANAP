import { BadRequestException } from '@nestjs/common';
import { lookup } from 'dns/promises';
import { BlockList, isIP, LookupFunction } from 'net';
import { Features } from '../config/features';

// Single source of truth for the outbound-target SSRF guard. Blocks private /
// internal / link-local ranges so a tenant-supplied URL cannot reach internal
// services (RFC1918, loopback, cloud metadata, CGNAT, IPv6 ULA/link-local).
const DISALLOWED_ADDRESS_BLOCKLIST = new BlockList();
DISALLOWED_ADDRESS_BLOCKLIST.addSubnet('0.0.0.0', 8, 'ipv4');
DISALLOWED_ADDRESS_BLOCKLIST.addSubnet('10.0.0.0', 8, 'ipv4');
DISALLOWED_ADDRESS_BLOCKLIST.addSubnet('100.64.0.0', 10, 'ipv4');
DISALLOWED_ADDRESS_BLOCKLIST.addSubnet('127.0.0.0', 8, 'ipv4');
DISALLOWED_ADDRESS_BLOCKLIST.addSubnet('169.254.0.0', 16, 'ipv4');
DISALLOWED_ADDRESS_BLOCKLIST.addSubnet('172.16.0.0', 12, 'ipv4');
DISALLOWED_ADDRESS_BLOCKLIST.addSubnet('192.0.0.0', 24, 'ipv4');
DISALLOWED_ADDRESS_BLOCKLIST.addSubnet('192.0.2.0', 24, 'ipv4');
DISALLOWED_ADDRESS_BLOCKLIST.addSubnet('192.168.0.0', 16, 'ipv4');
DISALLOWED_ADDRESS_BLOCKLIST.addSubnet('198.18.0.0', 15, 'ipv4');
DISALLOWED_ADDRESS_BLOCKLIST.addSubnet('198.51.100.0', 24, 'ipv4');
DISALLOWED_ADDRESS_BLOCKLIST.addSubnet('203.0.113.0', 24, 'ipv4');
DISALLOWED_ADDRESS_BLOCKLIST.addSubnet('224.0.0.0', 4, 'ipv4');
DISALLOWED_ADDRESS_BLOCKLIST.addSubnet('::', 128, 'ipv6');
DISALLOWED_ADDRESS_BLOCKLIST.addSubnet('::1', 128, 'ipv6');
DISALLOWED_ADDRESS_BLOCKLIST.addSubnet('fc00::', 7, 'ipv6');
DISALLOWED_ADDRESS_BLOCKLIST.addSubnet('fe80::', 10, 'ipv6');
DISALLOWED_ADDRESS_BLOCKLIST.addSubnet('ff00::', 8, 'ipv6');
DISALLOWED_ADDRESS_BLOCKLIST.addSubnet('2001:db8::', 32, 'ipv6');
// IPv6 prefixes that carry an IPv4 address (IPv4-compatible, NAT64, local-use
// NAT64, 6to4). The embedded IPv4 address is also checked on its own (see
// embeddedIpv4Address).
DISALLOWED_ADDRESS_BLOCKLIST.addSubnet('::', 96, 'ipv6');
DISALLOWED_ADDRESS_BLOCKLIST.addSubnet('64:ff9b::', 96, 'ipv6');
DISALLOWED_ADDRESS_BLOCKLIST.addSubnet('64:ff9b:1::', 48, 'ipv6');
DISALLOWED_ADDRESS_BLOCKLIST.addSubnet('2002::', 16, 'ipv6');

export type LookupFn = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<Array<{ address: string }>>;

export type PublicHttpTargetOptions = {
  // Default: enforce in multi-tenant cloud, skip in single-tenant / on-prem where
  // private RFC1918 / localhost / internal-DNS targets (GLPI, Ollama, PRTG) are legitimate.
  enforcePrivateBlock?: boolean;
  lookupFn?: LookupFn; // test seam; defaults to the real DNS resolver
};

function shouldEnforce(opts?: PublicHttpTargetOptions): boolean {
  return opts?.enforcePrivateBlock ?? !Features.SINGLE_TENANT;
}

function stripBrackets(host: string): string {
  // Node's URL.hostname wraps IPv6 literals in brackets, e.g. "[::1]".
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

// Operator escape hatch: hosts/IPs listed in SSRF_ALLOWED_HOSTS are permitted even
// when they would otherwise be blocked as private. Empty by default, so cloud/prod
// behavior is unchanged — set it only for dev / on-prem to reach known-good internal
// services (e.g. a local GLPI/PRTG). Read per-call so tests/env changes take effect.
function envHostAllowlist(): Set<string> {
  const raw = process.env.SSRF_ALLOWED_HOSTS ?? '';
  return new Set(
    raw.split(',').map((h) => stripBrackets(h.trim().toLowerCase())).filter(Boolean),
  );
}

function isAllowlistedHost(hostname: string, allow: Set<string>): boolean {
  if (allow.size === 0) return false;
  return allow.has(stripBrackets(String(hostname || '').trim().toLowerCase()));
}

// Expands an IPv6 literal into its eight 16-bit groups, or returns null when the
// value is not an IPv6 address. Accepts the compressed (::), dotted-quad tail and
// zone-id (%eth0) forms.
function ipv6Groups(address: string): number[] | null {
  if (isIP(address) !== 6) return null;
  let text = address.toLowerCase();
  const zoneIndex = text.indexOf('%');
  if (zoneIndex >= 0) text = text.slice(0, zoneIndex);
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const [a, b, c, d] = tail.split('.').map((octet) => Number(octet));
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = text.split('::');
  const headGroups = head ? head.split(':') : [];
  let groups: string[];
  if (rest === undefined) {
    groups = headGroups;
  } else {
    const restGroups = rest ? rest.split(':') : [];
    groups = [
      ...headGroups,
      ...new Array(8 - headGroups.length - restGroups.length).fill('0'),
      ...restGroups,
    ];
  }
  if (groups.length !== 8) return null;
  return groups.map((group) => parseInt(group, 16));
}

// Returns the IPv4 address an IPv6 address carries, when it uses one of the forms
// that embed one: IPv4-mapped (::ffff:a.b.c.d), IPv4-translated (::ffff:0:a.b.c.d),
// IPv4-compatible (::a.b.c.d), NAT64 (64:ff9b::/96), local-use NAT64
// (64:ff9b:1::/48, IPv4 in the last 32 bits) and 6to4 (2002::/16).
export function embeddedIpv4Address(address: string): string | null {
  const groups = ipv6Groups(address);
  if (!groups) return null;
  const zeros = (from: number, to: number) => groups.slice(from, to).every((group) => group === 0);
  const toIpv4 = (high: number, low: number) => `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
  if (zeros(0, 5) && groups[5] === 0xffff) return toIpv4(groups[6], groups[7]);
  if (zeros(0, 4) && groups[4] === 0xffff && groups[5] === 0) return toIpv4(groups[6], groups[7]);
  if (zeros(0, 6)) return toIpv4(groups[6], groups[7]);
  if (groups[0] === 0x64 && groups[1] === 0xff9b && zeros(2, 6)) return toIpv4(groups[6], groups[7]);
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups[2] === 1) return toIpv4(groups[6], groups[7]);
  if (groups[0] === 0x2002) return toIpv4(groups[1], groups[2]);
  return null;
}

function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (!family) return false;
  if (family === 4) return DISALLOWED_ADDRESS_BLOCKLIST.check(address, 'ipv4');
  if (DISALLOWED_ADDRESS_BLOCKLIST.check(address, 'ipv6')) return true;
  const ipv4 = embeddedIpv4Address(address);
  return ipv4 !== null && DISALLOWED_ADDRESS_BLOCKLIST.check(ipv4, 'ipv4');
}

function parseHttpUrl(target: string | URL): URL {
  let parsed: URL;
  if (target instanceof URL) {
    parsed = target;
  } else {
    const normalized = String(target || '').trim();
    if (!normalized) throw new BadRequestException('A URL is required.');
    try {
      parsed = new URL(normalized);
    } catch {
      throw new BadRequestException('Value must be a valid HTTP(S) URL.');
    }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException('Only http:// or https:// URLs are supported.');
  }
  if (parsed.username || parsed.password) {
    throw new BadRequestException('URLs must not include embedded credentials.');
  }
  return parsed;
}

function assertHostLiteral(hostname: string): void {
  const raw = String(hostname || '').trim().toLowerCase();
  if (!raw) throw new BadRequestException('Invalid target host.');
  const host = stripBrackets(raw); // unbracket so isIP()/BlockList detect IPv6 literals
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new BadRequestException('Private or internal hosts are not allowed.');
  }
  if (isBlockedAddress(host)) {
    throw new BadRequestException('Private or internal hosts are not allowed.');
  }
}

// Sync guard for config-save time: parse + protocol + credentials always; literal-IP /
// localhost blocklist when enforcing. No DNS (won't reject bare DNS names or fail on
// transient resolution). Returns the parsed URL.
export function assertPublicHttpUrl(target: string | URL, opts?: PublicHttpTargetOptions): URL {
  const url = parseHttpUrl(target);
  if (shouldEnforce(opts) && !isAllowlistedHost(url.hostname, envHostAllowlist())) {
    assertHostLiteral(url.hostname);
  }
  return url;
}

export type ValidatedAddress = { address: string; family: 4 | 6 };

export type PublicHttpTarget = {
  url: URL;
  // The addresses the host name resolved to, all of which passed the checks. The
  // connection must go to one of them (see pinnedLookup) so that a second
  // resolution cannot send it elsewhere. Null when nothing was resolved: checks
  // not enforced (single-tenant) or an allowlisted host.
  addresses: ValidatedAddress[] | null;
};

// Full guard for immediately before an outbound request: sync checks + DNS
// resolution of every A/AAAA record against the blocklist. Returns the validated
// addresses so the caller can connect to them (pinnedLookup).
export async function resolvePublicHttpTarget(
  target: string | URL,
  opts?: PublicHttpTargetOptions,
): Promise<PublicHttpTarget> {
  const url = parseHttpUrl(target);
  if (!shouldEnforce(opts)) return { url, addresses: null };
  const allow = envHostAllowlist();
  if (isAllowlistedHost(url.hostname, allow)) return { url, addresses: null };
  assertHostLiteral(url.hostname);
  const lookupFn = opts?.lookupFn ?? (lookup as unknown as LookupFn);
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookupFn(stripBrackets(url.hostname), { all: true, verbatim: true });
  } catch {
    throw new BadRequestException('Unable to resolve target host.');
  }
  if (!addresses.length) throw new BadRequestException('Unable to resolve target host.');
  // A resolved address is blocked unless it is explicitly allowlisted (covers a DNS
  // name that legitimately points at an allowlisted internal IP).
  if (addresses.some(({ address }) => isBlockedAddress(address) && !allow.has(address.toLowerCase()))) {
    throw new BadRequestException('Private or internal hosts are not allowed.');
  }
  const validated: ValidatedAddress[] = [];
  for (const { address } of addresses) {
    const family = isIP(address);
    if (family === 4 || family === 6) validated.push({ address, family });
  }
  if (!validated.length) throw new BadRequestException('Unable to resolve target host.');
  return { url, addresses: validated };
}

// Same checks as resolvePublicHttpTarget, for callers that only need the URL.
export async function assertPublicHttpTarget(
  target: string | URL,
  opts?: PublicHttpTargetOptions,
): Promise<URL> {
  return (await resolvePublicHttpTarget(target, opts)).url;
}

// A `lookup` for net/tls/http(s) connections that answers with the addresses
// validated by resolvePublicHttpTarget instead of resolving the name again. The
// host name itself is untouched, so TLS (SNI, certificate check) and the Host
// header keep using the name from the URL.
export function pinnedLookup(hostname: string, addresses: ValidatedAddress[]): LookupFunction {
  const expected = stripBrackets(String(hostname || '').trim().toLowerCase());
  return (name, options, callback) => {
    const requested = options?.family === 'IPv4' ? 4 : options?.family === 'IPv6' ? 6 : Number(options?.family || 0);
    const matching = stripBrackets(String(name || '').trim().toLowerCase()) === expected
      ? addresses.filter((entry) => requested !== 4 && requested !== 6 ? true : entry.family === requested)
      : [];
    if (!matching.length) {
      const error: NodeJS.ErrnoException = new Error(`No validated address for ${name}.`);
      error.code = 'ENOTFOUND';
      callback(error, '');
      return;
    }
    if (options?.all) {
      callback(null, matching.map((entry) => ({ address: entry.address, family: entry.family })));
      return;
    }
    callback(null, matching[0].address, matching[0].family);
  };
}
