import { Injectable, Logger } from '@nestjs/common';
import { promises as dnsPromises } from 'dns';
import { fetchForTarget } from '../../common/pinned-fetch';
import { LookupFn, resolvePublicHttpTarget } from '../../common/ssrf-guard';
import { isAcceptableRedirectUri, MAX_OAUTH_URL_LENGTH } from './mcp-oauth.util';

/**
 * Client ID Metadata Documents (CIMD, MCP authorization 2025-11-25): an OAuth client's `client_id`
 * is an https URL serving a JSON document with its name and redirect URIs. KANAP keeps no client
 * table: the document is fetched when a signed-in user looks at an authorization request.
 *
 * The fetch is an outbound request whose target a third party chooses, so every SSRF rule applies,
 * in every deployment mode and with no operator allowlist: https on port 443 only, the host must
 * resolve to public addresses only and the connection goes to those very addresses (pinned, no
 * second resolution), no redirect, 5 s, 16 KB.
 *
 * It must not hurt the rest of the API either: names are resolved with c-ares (a `Resolver`, off
 * libuv's threadpool, which password hashing shares), at most CIMD_MAX_IN_FLIGHT fetches run at
 * once per process, concurrent requests for one document share one fetch, and failures are cached
 * for a minute. The caller only ever sees one generic message; the reason goes to the log.
 */

export const CIMD_TIMEOUT_MS = 5_000;
export const CIMD_MAX_BYTES = 16 * 1024;
export const CIMD_CACHE_TTL_MS = 60 * 60_000;
export const CIMD_FAILURE_TTL_MS = 60_000;
export const CIMD_MAX_IN_FLIGHT = 6;
const CIMD_DNS_TIMEOUT_MS = 1_500;
const CIMD_CACHE_MAX_ENTRIES = 500;

export const CIMD_PUBLIC_ERROR = 'The client metadata document cannot be used.';

export type ClientMetadata = {
  client_id: string;
  client_name: string;
  client_uri: string | null;
  logo_uri: string | null;
  redirect_uris: string[];
};

export type CimdFailureReason =
  | 'invalid_client_id'
  | 'busy'
  | 'unreachable'
  | 'redirect'
  | 'http_status'
  | 'too_large'
  | 'timeout'
  | 'not_json'
  | 'client_id_mismatch'
  | 'no_redirect_uris'
  | 'not_public_client';

/** A refused document: `reason` for the log and the specs, one generic message for the caller. */
export class CimdError extends Error {
  constructor(readonly reason: CimdFailureReason, readonly detail?: string) {
    super(CIMD_PUBLIC_ERROR);
    this.name = 'CimdError';
  }
}

/** Test seams: DNS resolution, the request itself, the clock and the time limit. */
export type CimdFetcherOptions = {
  lookupFn?: LookupFn;
  /** Replaces the pinned fetch; receives the validated URL. */
  fetchImpl?: (url: URL, init: RequestInit) => Promise<Response>;
  now?: () => number;
  timeoutMs?: number;
};

/** A client_id the authorization server accepts as a CIMD URL: https, default port, a path. */
export function isCimdClientId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_OAUTH_URL_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  // The document URL is the client's identity: it must contain a path and no fragment.
  return url.protocol === 'https:'
    && url.port === ''
    && !url.username && !url.password && !url.hash
    && url.pathname !== '' && url.pathname !== '/';
}

/**
 * Names resolved with c-ares, off the threadpool, with a short time limit: A and AAAA records,
 * every address returned (the SSRF guard refuses the name when any of them is not public).
 */
export function createCimdLookup(): LookupFn {
  return async (hostname) => {
    const resolver = new dnsPromises.Resolver({ timeout: CIMD_DNS_TIMEOUT_MS, tries: 1 });
    const [v4, v6] = await Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)]);
    const addresses = [
      ...(v4.status === 'fulfilled' ? v4.value : []),
      ...(v6.status === 'fulfilled' ? v6.value : []),
    ];
    if (addresses.length === 0) throw new Error(`No address for ${hostname}.`);
    return addresses.map((address) => ({ address }));
  };
}

function optionalHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_OAUTH_URL_LENGTH) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Control and bidirectional formatting characters: they could disguise a client's name. */
const UNSAFE_NAME_CHARACTERS = /[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/g;

export function cleanClientName(value: unknown, fallback: string): string {
  const raw = typeof value === 'string' ? value.replace(UNSAFE_NAME_CHARACTERS, '').replace(/\s+/g, ' ').trim() : '';
  return raw ? raw.slice(0, 100) : fallback;
}

export function parseClientMetadata(clientId: string, body: unknown): ClientMetadata {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new CimdError('not_json');
  }
  const doc = body as Record<string, unknown>;
  if (doc.client_id !== clientId) {
    throw new CimdError('client_id_mismatch');
  }
  // Unusable entries are left out; at least one must remain.
  const redirectUris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.filter(isAcceptableRedirectUri) : [];
  if (redirectUris.length === 0) {
    throw new CimdError('no_redirect_uris');
  }
  // A public client: anything else would need a client secret this server does not issue.
  if (doc.token_endpoint_auth_method !== undefined && doc.token_endpoint_auth_method !== 'none') {
    throw new CimdError('not_public_client');
  }
  return {
    client_id: clientId,
    client_name: cleanClientName(doc.client_name, new URL(clientId).hostname),
    client_uri: optionalHttpsUrl(doc.client_uri),
    logo_uri: optionalHttpsUrl(doc.logo_uri),
    redirect_uris: redirectUris,
  };
}

async function readLimitedBody(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > CIMD_MAX_BYTES) {
    throw new CimdError('too_large');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > CIMD_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new CimdError('too_large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

type CacheEntry = { metadata: ClientMetadata; expiresAt: number } | { error: CimdError; expiresAt: number };

@Injectable()
export class CimdFetcherService {
  private readonly logger = new Logger(CimdFetcherService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<ClientMetadata>>();
  private inFlight = 0;
  private options: CimdFetcherOptions = {};
  private lookupFn: LookupFn = createCimdLookup();

  /** Specs only. */
  configure(options: CimdFetcherOptions): this {
    this.options = options;
    this.lookupFn = options.lookupFn ?? createCimdLookup();
    this.cache.clear();
    this.pending.clear();
    return this;
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  async fetch(clientId: string): Promise<ClientMetadata> {
    if (!isCimdClientId(clientId)) throw new CimdError('invalid_client_id');
    const cached = this.cache.get(clientId);
    if (cached && cached.expiresAt > this.now()) {
      if ('error' in cached) throw cached.error;
      return cached.metadata;
    }
    const shared = this.pending.get(clientId);
    if (shared) return shared;
    if (this.inFlight >= CIMD_MAX_IN_FLIGHT) throw new CimdError('busy');

    this.inFlight += 1;
    const attempt = this.load(clientId).finally(() => {
      this.inFlight -= 1;
      this.pending.delete(clientId);
    });
    this.pending.set(clientId, attempt);
    return attempt;
  }

  private async load(clientId: string): Promise<ClientMetadata> {
    try {
      const metadata = parseClientMetadata(clientId, await this.download(clientId));
      this.remember(clientId, { metadata, expiresAt: this.now() + CIMD_CACHE_TTL_MS });
      return metadata;
    } catch (error) {
      const refused = error instanceof CimdError ? error : new CimdError('unreachable');
      this.logger.warn(`Client metadata document ${JSON.stringify(clientId.slice(0, 200))} refused: ${refused.reason}${refused.detail ? ` (${refused.detail})` : ''}`);
      this.remember(clientId, { error: refused, expiresAt: this.now() + CIMD_FAILURE_TTL_MS });
      throw refused;
    }
  }

  private remember(clientId: string, entry: CacheEntry) {
    this.cache.delete(clientId);
    if (this.cache.size >= CIMD_CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(clientId, entry);
  }

  private async download(clientId: string): Promise<unknown> {
    let target;
    try {
      target = await resolvePublicHttpTarget(clientId, {
        enforcePrivateBlock: true,
        ignoreHostAllowlist: true,
        lookupFn: this.lookupFn,
      });
    } catch (error) {
      throw new CimdError('unreachable', (error as Error).message);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? CIMD_TIMEOUT_MS);
    const pinned = this.options.fetchImpl ? null : fetchForTarget(target);
    try {
      const init: RequestInit = {
        method: 'GET',
        headers: { accept: 'application/json' },
        redirect: 'manual',
        signal: controller.signal,
      };
      const response = this.options.fetchImpl
        ? await this.options.fetchImpl(target.url, init)
        : await pinned!.fetch(target.url.toString(), init);
      if (response.status >= 300 && response.status < 400) throw new CimdError('redirect');
      if (response.status !== 200) throw new CimdError('http_status', String(response.status));
      const text = await readLimitedBody(response);
      try {
        return JSON.parse(text);
      } catch {
        throw new CimdError('not_json');
      }
    } catch (error) {
      if (error instanceof CimdError) throw error;
      if (controller.signal.aborted) throw new CimdError('timeout');
      throw new CimdError('unreachable', (error as Error)?.message);
    } finally {
      clearTimeout(timer);
      await pinned?.close();
    }
  }
}
