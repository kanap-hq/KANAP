import { Injectable } from '@nestjs/common';
import { fetchForTarget } from '../../common/pinned-fetch';
import { LookupFn, resolvePublicHttpTarget } from '../../common/ssrf-guard';
import { isAcceptableRedirectUri } from './mcp-oauth.util';

/**
 * Client ID Metadata Documents (CIMD, MCP authorization 2025-11-25): an OAuth client's `client_id`
 * is an https URL serving a JSON document with its name and redirect URIs. KANAP keeps no client
 * table: the document is fetched at authorization time.
 *
 * The fetch is an outbound request whose target a third party chooses, so every SSRF rule applies,
 * in every deployment mode: https only, the host must resolve to public addresses only and the
 * connection goes to those very addresses (pinned, no second resolution), no redirect, 5 s, 16 KB.
 * `SSRF_ALLOWED_HOSTS` stays the operator's escape hatch (common/ssrf-guard.ts).
 */

export const CIMD_TIMEOUT_MS = 5_000;
export const CIMD_MAX_BYTES = 16 * 1024;
export const CIMD_CACHE_TTL_MS = 60 * 60_000;
const CIMD_CACHE_MAX_ENTRIES = 500;

export type ClientMetadata = {
  client_id: string;
  client_name: string;
  client_uri: string | null;
  logo_uri: string | null;
  redirect_uris: string[];
};

export class CimdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CimdError';
  }
}

/** Test seams: DNS resolution and the request itself. */
export type CimdFetcherOptions = {
  lookupFn?: LookupFn;
  /** Replaces the pinned fetch; receives the validated URL. */
  fetchImpl?: (url: URL, init: RequestInit) => Promise<Response>;
  now?: () => number;
  timeoutMs?: number;
};

/** A client_id the authorization server accepts as a CIMD URL. */
export function isCimdClientId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  // The document URL is the client's identity: it must contain a path and no fragment.
  return url.protocol === 'https:'
    && !url.username && !url.password && !url.hash
    && url.pathname !== '' && url.pathname !== '/';
}

function optionalHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function parseClientMetadata(clientId: string, body: unknown): ClientMetadata {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new CimdError('The client metadata document is not a JSON object.');
  }
  const doc = body as Record<string, unknown>;
  if (doc.client_id !== clientId) {
    throw new CimdError('The client metadata document names another client_id.');
  }
  const redirectUris = doc.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || !redirectUris.every(isAcceptableRedirectUri)) {
    throw new CimdError('The client metadata document has no acceptable redirect_uris.');
  }
  // A public client: anything else would need a client secret this server does not issue.
  if (doc.token_endpoint_auth_method !== undefined && doc.token_endpoint_auth_method !== 'none') {
    throw new CimdError('Only public clients (token_endpoint_auth_method "none") are supported.');
  }
  const rawName = typeof doc.client_name === 'string' ? doc.client_name.trim() : '';
  const clientName = rawName ? rawName.slice(0, 100) : new URL(clientId).hostname;
  return {
    client_id: clientId,
    client_name: clientName,
    client_uri: optionalHttpsUrl(doc.client_uri),
    logo_uri: optionalHttpsUrl(doc.logo_uri),
    redirect_uris: [...redirectUris] as string[],
  };
}

async function readLimitedBody(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > CIMD_MAX_BYTES) {
    throw new CimdError('The client metadata document is too large.');
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
      throw new CimdError('The client metadata document is too large.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

@Injectable()
export class CimdFetcherService {
  private readonly cache = new Map<string, { metadata: ClientMetadata; expiresAt: number }>();
  private options: CimdFetcherOptions = {};

  /** Specs only. */
  configure(options: CimdFetcherOptions): this {
    this.options = options;
    this.cache.clear();
    return this;
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  async fetch(clientId: string): Promise<ClientMetadata> {
    if (!isCimdClientId(clientId)) {
      throw new CimdError('client_id must be an https URL of a client metadata document.');
    }
    const cached = this.cache.get(clientId);
    if (cached && cached.expiresAt > this.now()) return cached.metadata;

    const metadata = parseClientMetadata(clientId, await this.download(clientId));
    if (this.cache.size >= CIMD_CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(clientId, { metadata, expiresAt: this.now() + CIMD_CACHE_TTL_MS });
    return metadata;
  }

  private async download(clientId: string): Promise<unknown> {
    let target;
    try {
      target = await resolvePublicHttpTarget(clientId, {
        enforcePrivateBlock: true,
        lookupFn: this.options.lookupFn,
      });
    } catch (error) {
      throw new CimdError(`The client metadata document cannot be fetched: ${(error as Error).message}`);
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
      if (response.status >= 300 && response.status < 400) {
        throw new CimdError('The client metadata document URL redirects: redirects are not followed.');
      }
      if (response.status !== 200) {
        throw new CimdError(`The client metadata document answered HTTP ${response.status}.`);
      }
      const text = await readLimitedBody(response);
      try {
        return JSON.parse(text);
      } catch {
        throw new CimdError('The client metadata document is not valid JSON.');
      }
    } catch (error) {
      if (error instanceof CimdError) throw error;
      if (controller.signal.aborted) throw new CimdError('The client metadata document took too long to answer.');
      throw new CimdError('The client metadata document cannot be fetched.');
    } finally {
      clearTimeout(timer);
      await pinned?.close();
    }
  }
}
