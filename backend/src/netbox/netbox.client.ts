import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import * as http from 'node:http';
import * as https from 'node:https';
import { LookupFunction } from 'node:net';
import { LookupFn, pinnedLookup, resolvePublicHttpTarget } from '../common/ssrf-guard';
import {
  normalizeNetboxDevice,
  normalizeNetboxLocation,
  normalizeNetboxVirtualMachine,
} from './netbox-mapper';
import {
  NetboxApiError,
  NetboxConnection,
  NetboxLocation,
  NetboxObject,
  NetboxReferenceOption,
} from './netbox.types';
import { isRecord } from '../common/object-guards';

// Read client for the Netbox REST API. No new npm dependency: plain
// node:http / node:https so "ignore certificate" can be scoped to a single
// request (rejectUnauthorized:false) instead of the whole process.
//
// Two rules the transport never breaks:
//  - the SSRF guard runs before EVERY request, not only when the connection is
//    saved, and redirects are never followed (a public host must not be able
//    to bounce us onto an internal one);
//  - Netbox returns an ABSOLUTE `next` URL for the following page. We ignore
//    it and compute limit/offset ourselves from `count`, because behind a
//    reverse proxy that URL can point at a completely different host.

const NETBOX_TIMEOUT_MS = 30_000;
// The admin "test connection" button is interactive: keep it snappy unless the
// operator tuned a timeout for a slow server.
const NETBOX_TEST_TIMEOUT_MS = 5_000;

export const NETBOX_MIN_TIMEOUT_SECONDS = 5;
export const NETBOX_MAX_TIMEOUT_SECONDS = 120;

// Objects per page. Netbox caps this server-side (MAX_PAGE_SIZE, 1000 by
// default); 200 keeps a page small enough to parse comfortably.
const PAGE_SIZE = 200;
// Safety net so a Netbox that keeps reporting a growing `count` cannot loop
// forever: 200 pages is 40 000 objects.
const MAX_PAGES = 200;
// A single response larger than this is not an inventory page, it is a problem.
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

export type NetboxHttpResponse = {
  status: number;
  body: string;
  contentType: string | null;
};

export type NetboxHttpRequest = {
  headers: Record<string, string>;
  timeoutMs: number;
  insecureTls: boolean;
  // Connects to the addresses validated before the request (multi-tenant mode).
  lookup?: LookupFunction;
};

export type NetboxHttpLike = (url: string, request: NetboxHttpRequest) => Promise<NetboxHttpResponse>;

/** A whole list endpoint, and whether the walk reached the end of it. */
export type NetboxObjectPage = { objects: NetboxObject[]; complete: boolean };

// Optional DI token so specs can inject a fake transport; production leaves it
// unbound and the client uses node:https / node:http.
export const NETBOX_HTTP_IMPLEMENTATION = 'NETBOX_HTTP_IMPLEMENTATION';
// Optional DI token so specs can stand in for DNS in the request-time address
// check; production leaves it unbound and the system resolver is used.
export const NETBOX_ADDRESS_LOOKUP = 'NETBOX_ADDRESS_LOOKUP';

// Node reports certificate problems through these error codes. They all mean
// the same thing to an administrator: KANAP does not trust this certificate.
const TLS_ERROR_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

const TLS_MESSAGE = 'KANAP does not trust the certificate of the Netbox server. '
  + 'Install a certificate KANAP trusts, or turn on "Ignore certificate" for this connection.';

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

/** A count Netbox actually sent, or null when it sent none we can use. */
function finiteCountOrNull(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : (typeof value === 'string' ? Number(value.trim()) : NaN);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function countOrZero(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

/** Removes anything token-shaped from free-form transport text. */
export function sanitizeNetboxText(value: string, token?: string): string {
  let text = String(value || '');
  const secret = String(token || '').trim();
  if (secret.length >= 6) {
    text = text.split(secret).join('***');
  }
  return text.replace(/(Token|Bearer)\s+\S+/gi, '$1 ***');
}

/**
 * Netbox works out the token version from the value itself (a version 2 token
 * reads `nbt_<key>.<secret>`), not from the keyword, so `Token <value>` is
 * accepted for both. Verified against Netbox 4.7.1.
 */
export function netboxAuthorizationHeader(token: string): string {
  return `Token ${String(token || '').trim()}`;
}

export function normalizeNetboxBaseUrl(raw: string): string {
  return String(raw || '').trim().replace(/\/+$/, '');
}

/** Clamps an operator-set timeout to a sane window; null keeps the default. */
export function clampNetboxTimeoutSeconds(value: number): number {
  return Math.max(NETBOX_MIN_TIMEOUT_SECONDS, Math.min(NETBOX_MAX_TIMEOUT_SECONDS, Math.floor(value)));
}

function connectionTimeoutMs(connection: NetboxConnection): number {
  const value = connection.requestTimeoutMs;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : NETBOX_TIMEOUT_MS;
}

// Default transport. Redirects are never followed: node:http does not follow
// them on its own, and a 3xx is reported as an invalid response instead.
const nodeHttpTransport: NetboxHttpLike = (url, request) => new Promise((resolve, reject) => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    reject(new NetboxApiError('provider_unavailable', 'The Netbox server address is not a valid web address.'));
    return;
  }
  const transport = parsed.protocol === 'http:' ? http : https;
  const req = transport.request(
    parsed,
    {
      method: 'GET',
      headers: request.headers,
      // A bound connection gets an agent of its own (agent: false): the shared
      // keep-alive pool could hand it a socket opened without this lookup.
      ...(request.lookup ? { lookup: request.lookup, agent: false } : {}),
      ...(parsed.protocol === 'https:' && request.insecureTls ? { rejectUnauthorized: false } : {}),
    },
    (res) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          res.destroy();
          reject(new NetboxApiError('invalid_response', 'The Netbox server sent an unexpectedly large response.'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
          contentType: textOrNull(res.headers['content-type']),
        });
      });
      res.on('error', reject);
    },
  );
  req.setTimeout(request.timeoutMs, () => {
    req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
  });
  req.on('error', reject);
  req.end();
});

@Injectable()
export class NetboxClient {
  private readonly logger = new Logger(NetboxClient.name);
  private readonly httpImpl: NetboxHttpLike;
  private readonly addressLookup: LookupFn | undefined;

  constructor(
    @Optional() @Inject(NETBOX_HTTP_IMPLEMENTATION) httpImpl?: NetboxHttpLike,
    @Optional() @Inject(NETBOX_ADDRESS_LOOKUP) addressLookup?: LookupFn,
  ) {
    this.httpImpl = httpImpl ?? nodeHttpTransport;
    this.addressLookup = addressLookup;
  }

  /** GET /api/status/ — connectivity probe; returns the reported Netbox version. */
  async getVersion(connection: NetboxConnection): Promise<string | null> {
    const payload = await this.requestJson(
      connection,
      '/api/status/',
      {},
      connection.requestTimeoutMs ?? NETBOX_TEST_TIMEOUT_MS,
    );
    if (!isRecord(payload)) {
      throw new NetboxApiError('invalid_response', 'The Netbox server did not return its status.');
    }
    return textOrNull(payload['netbox-version']) ?? textOrNull(payload.netbox_version);
  }

  /** GET /api/dcim/devices/ — every device, paginated. */
  async listDevices(connection: NetboxConnection): Promise<NetboxObjectPage> {
    const page = await this.listAll(connection, '/api/dcim/devices/', { exclude: 'config_context' });
    return {
      objects: page.rows.map((row) => normalizeNetboxDevice(row, connection.baseUrl)),
      complete: page.complete,
    };
  }

  /** GET /api/virtualization/virtual-machines/ — every VM, paginated. */
  async listVirtualMachines(connection: NetboxConnection): Promise<NetboxObjectPage> {
    const page = await this.listAll(connection, '/api/virtualization/virtual-machines/', { exclude: 'config_context' });
    return {
      objects: page.rows.map((row) => normalizeNetboxVirtualMachine(row, connection.baseUrl)),
      complete: page.complete,
    };
  }

  /** GET /api/dcim/devices/<id>/ — one device, for a single-record action. */
  async getDevice(connection: NetboxConnection, id: string): Promise<NetboxObject> {
    return normalizeNetboxDevice(await this.getOne(connection, `/api/dcim/devices/${encodeURIComponent(id)}/`), connection.baseUrl);
  }

  /** GET /api/virtualization/virtual-machines/<id>/ — one virtual machine. */
  async getVirtualMachine(connection: NetboxConnection, id: string): Promise<NetboxObject> {
    return normalizeNetboxVirtualMachine(
      await this.getOne(connection, `/api/virtualization/virtual-machines/${encodeURIComponent(id)}/`),
      connection.baseUrl,
    );
  }

  private async getOne(connection: NetboxConnection, path: string): Promise<Record<string, unknown>> {
    let payload: unknown;
    try {
      payload = await this.requestJson(connection, path, { exclude: 'config_context' }, connectionTimeoutMs(connection));
    } catch (error) {
      if (error instanceof NetboxApiError && error.errorCode === 'not_found') {
        throw new NetboxApiError('not_found', 'Netbox does not list this object any more.');
      }
      throw error;
    }
    if (!isRecord(payload) || textOrNull(payload.id) == null) {
      throw new NetboxApiError('invalid_response', 'The Netbox server returned an unexpected answer for this object.');
    }
    return payload;
  }

  /**
   * GET /api/dcim/device-roles/ — roles, used as the import filter for
   * devices. Virtual machines never go through a Netbox role in KANAP, so the
   * machine count on a role is reported as zero rather than as a number nobody
   * can act on.
   */
  async listRoles(connection: NetboxConnection): Promise<NetboxReferenceOption[]> {
    const { rows } = await this.listAll(connection, '/api/dcim/device-roles/', {});
    return rows.map((row) => ({ ...this.toReferenceOption(row), vm_count: 0 }));
  }

  /** GET /api/dcim/sites/ — sites, mapped onto KANAP locations. */
  async listSites(connection: NetboxConnection): Promise<NetboxReferenceOption[]> {
    const { rows } = await this.listAll(connection, '/api/dcim/sites/', {});
    return rows.map((row) => this.toReferenceOption(row));
  }

  /**
   * GET /api/dcim/platforms/ — the platforms Netbox uses to say what an object
   * runs. Devices and virtual machines share the same list, so both counts are
   * reported.
   */
  async listPlatforms(connection: NetboxConnection): Promise<NetboxReferenceOption[]> {
    const { rows } = await this.listAll(connection, '/api/dcim/platforms/', {});
    return rows.map((row) => this.toReferenceOption(row));
  }

  /**
   * GET /api/dcim/locations/ — the Location tree under each site. `complete`
   * matters as much as the rows: the caller only imports sub-locations from a
   * list it knows is whole, and a truncated tree would attach equipment to the
   * wrong level.
   */
  async listLocations(
    connection: NetboxConnection,
  ): Promise<{ locations: NetboxLocation[]; complete: boolean }> {
    const { rows, complete } = await this.listAll(connection, '/api/dcim/locations/', {});
    return {
      locations: rows.map((row) => normalizeNetboxLocation(row, connection.baseUrl)),
      complete,
    };
  }

  /** How many virtual machines Netbox holds, without fetching any of them. */
  async countVirtualMachines(connection: NetboxConnection): Promise<number> {
    const payload = await this.requestJson(
      connection,
      '/api/virtualization/virtual-machines/',
      { exclude: 'config_context', limit: '1', offset: '0' },
      connectionTimeoutMs(connection),
    );
    return isRecord(payload) ? countOrZero(payload.count) : 0;
  }

  private toReferenceOption(row: Record<string, unknown>): NetboxReferenceOption {
    return {
      slug: textOrNull(row.slug) ?? '',
      name: textOrNull(row.name) ?? textOrNull(row.slug) ?? '',
      device_count: countOrZero(row.device_count),
      vm_count: countOrZero(row.virtualmachine_count),
    };
  }

  /**
   * Walks a list endpoint with offsets we compute ourselves. `next` is read for
   * one thing only: whether another page exists. It is NEVER followed — behind
   * a reverse proxy that absolute URL can point at a different host.
   *
   * `count` is a stopping condition only when Netbox actually sends a number.
   * An absent or unparsable count used to read as zero, which ended the walk
   * after one page and made the whole rest of the inventory look as if it had
   * disappeared. Without a usable count the walk runs until a page comes back
   * empty or `next` is null.
   *
   * `complete` says whether the caller has the whole list: stopping on the
   * page cap does not mean there is nothing more.
   */
  private async listAll(
    connection: NetboxConnection,
    path: string,
    params: Record<string, string>,
  ): Promise<{ rows: Array<Record<string, unknown>>; complete: boolean }> {
    const collected: Array<Record<string, unknown>> = [];
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const payload = await this.requestJson(
        connection,
        path,
        { ...params, limit: String(PAGE_SIZE), offset: String(offset) },
        connectionTimeoutMs(connection),
      );
      if (!isRecord(payload) || !Array.isArray(payload.results)) {
        throw new NetboxApiError('invalid_response', `The Netbox server returned an unexpected answer for ${path}.`);
      }
      const results = payload.results.filter(isRecord);
      collected.push(...results);
      const total = finiteCountOrNull(payload.count);
      offset += PAGE_SIZE;
      if (results.length === 0 || payload.next == null || (total != null && collected.length >= total)) {
        return { rows: collected, complete: true };
      }
    }
    this.logger.warn(`Netbox ${path} returned more than ${MAX_PAGES} pages; the rest was not read.`);
    return { rows: collected, complete: false };
  }

  private async requestJson(
    connection: NetboxConnection,
    path: string,
    params: Record<string, string>,
    timeoutMs: number,
  ): Promise<unknown> {
    const url = new URL(`${normalizeNetboxBaseUrl(connection.baseUrl)}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    // Blocks internal targets in multi-tenant cloud (no-op on-prem, where a
    // private Netbox address is the normal case). DNS-checked here, at request
    // time, not only when the connection was saved; the request then connects to
    // the validated addresses only.
    const target = await resolvePublicHttpTarget(
      url.toString(),
      this.addressLookup ? { lookupFn: this.addressLookup } : undefined,
    );

    let response: NetboxHttpResponse;
    try {
      response = await this.httpImpl(url.toString(), {
        headers: {
          Authorization: netboxAuthorizationHeader(connection.token),
          Accept: 'application/json',
        },
        timeoutMs,
        insecureTls: connection.insecureTls === true,
        ...(target.addresses ? { lookup: pinnedLookup(url.hostname, target.addresses) } : {}),
      });
    } catch (error: any) {
      if (error instanceof NetboxApiError) {
        throw error;
      }
      const code = String(error?.code || '');
      if (TLS_ERROR_CODES.has(code)) {
        throw new NetboxApiError('tls_untrusted', TLS_MESSAGE);
      }
      if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || error?.name === 'AbortError') {
        throw new NetboxApiError('timeout', `The Netbox server did not answer within ${Math.round(timeoutMs / 1000)} seconds.`, true);
      }
      throw new NetboxApiError(
        'provider_unavailable',
        `KANAP could not reach the Netbox server: ${sanitizeNetboxText(String(error?.message || error || 'request failed'), connection.token)}`,
        true,
      );
    }

    if (response.status >= 300 && response.status < 400) {
      throw new NetboxApiError(
        'invalid_response',
        'The Netbox server address redirects somewhere else. Enter the address Netbox is actually served on.',
      );
    }
    if (response.status < 200 || response.status >= 300) {
      throw this.httpError(response.status, path);
    }

    const text = String(response.body || '').trim();
    if (!text) {
      return {};
    }
    try {
      return JSON.parse(text);
    } catch {
      if (text.startsWith('<')) {
        throw new NetboxApiError(
          'invalid_response',
          'The Netbox server returned a web page instead of data. Check that the address points at Netbox and not at a login portal in front of it.',
        );
      }
      throw new NetboxApiError('invalid_response', `The Netbox server returned an unreadable answer for ${path}.`);
    }
  }

  private httpError(status: number, path: string): NetboxApiError {
    // Netbox answers 403 for a token it does not recognise as well as for one
    // that lacks a permission, so both messages point at the token first.
    if (status === 401) {
      return new NetboxApiError('unauthorized', 'Netbox rejected the API token. Check that it was copied in full and has not expired.');
    }
    if (status === 403) {
      return new NetboxApiError('forbidden', 'Netbox rejected the API token. Check that it was copied in full, has not expired, and is allowed to read the inventory.');
    }
    if (status === 404) {
      return new NetboxApiError('not_found', `Netbox does not offer ${path}. Check the server address and the Netbox version.`);
    }
    if (status === 429) {
      return new NetboxApiError('rate_limited', 'Netbox is refusing more requests for the moment. Try again in a few minutes.', true);
    }
    if (status >= 500) {
      return new NetboxApiError('provider_unavailable', `The Netbox server reported an internal error (HTTP ${status}).`, true);
    }
    return new NetboxApiError('invalid_response', `Netbox refused the request for ${path} (HTTP ${status}).`);
  }
}
