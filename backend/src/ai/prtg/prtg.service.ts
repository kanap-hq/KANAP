import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { openValidatedFetch } from '../../common/pinned-fetch';
import { Features } from '../../config/features';
import {
  PrtgApiError,
  PrtgConnection,
  PrtgHistoricDataRequest,
  PrtgHistoricRow,
  PrtgSensorDetails,
  PrtgSensorTypeInUse,
  PrtgTableRequest,
  PrtgTableRow,
} from './prtg.types';
import { isRecord } from '../../common/object-guards';

// Sessionless HTTP client for the PRTG classic API (v1). Auth material rides
// in the query string (apitoken, or username+passhash fallback), so NO error
// message, log line, or thrown detail may ever contain a full request URL —
// everything goes through sanitizePrtgText / endpoint labels instead.
//
// Invocation: connection parameters come in per call (the monitoring adapter
// derives them from context.adapterRuntime); this service holds no state.

// Default for background ingestion/diagnosis calls. Raised from 10 s: on
// large or WAN-reached PRTG servers table.json regularly needs longer, and a
// timed-out call fails the whole alert diagnosis. Operators can tune it per
// adapter via the request-timeout setting (connection.requestTimeoutMs).
const PRTG_TIMEOUT_MS = 30_000;
// Admin "test connection" probes stay snappy: they are interactive. A
// configured per-adapter timeout still applies so a slow-but-working server
// can pass the test.
const PRTG_TEST_TIMEOUT_MS = 5_000;

// PRTG absolute `*_raw` datetime columns (lastcheck_raw, datetime_raw, ...)
// are OLE automation dates (days since 1899-12-30) expressed in the PRTG
// SERVER-LOCAL timezone, and sdate/edate request parameters are interpreted
// the same way. The server timezone is per-tenant adapter-config metadata
// (`server_timezone`, an IANA zone) carried on PrtgConnection; absent means
// UTC. Offsets are computed per-date via Intl so DST transitions are correct.

// Days between the OLE automation epoch (1899-12-30) and the Unix epoch.
const OLE_AUTOMATION_EPOCH_UNIX_DAYS = 25_569;
const MS_PER_DAY = 86_400_000;

// Intl.DateTimeFormat construction is expensive — cache one per zone. An
// unknown/invalid zone falls back to UTC instead of throwing: runtime date
// conversion must never take a whole ingestion cycle down, and the admin
// write path validates the zone before it is ever stored.
const ZONE_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = ZONE_FORMATTER_CACHE.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      });
    } catch {
      formatter = zoneFormatter('UTC');
    }
    ZONE_FORMATTER_CACHE.set(timeZone, formatter);
  }
  return formatter;
}

function normalizeZone(serverTimeZone: string | null | undefined): string {
  const zone = typeof serverTimeZone === 'string' ? serverTimeZone.trim() : '';
  return zone || 'UTC';
}

type WallClockParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

// Wall-clock reading of a UTC instant in the given zone (second precision).
function wallClockPartsInZone(utcMs: number, timeZone: string): WallClockParts {
  const parts: Partial<Record<string, number>> = {};
  for (const part of zoneFormatter(timeZone).formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') {
      parts[part.type] = Number(part.value);
    }
  }
  return {
    year: parts.year ?? 1970,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

// Zone offset (minutes to ADD to UTC to get zone wall-clock) at a UTC instant.
function zoneOffsetMinutes(timeZone: string, utcMs: number): number {
  const wall = wallClockPartsInZone(utcMs, timeZone);
  const wallMs = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return Math.round((wallMs - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

// Server-local wall-clock ms (as if UTC) → real UTC ms. Two probe passes make
// the offset self-consistent across DST transitions without a library.
function wallClockMsToUtcMs(wallMs: number, timeZone: string): number {
  let utcMs = wallMs - zoneOffsetMinutes(timeZone, wallMs) * 60_000;
  utcMs = wallMs - zoneOffsetMinutes(timeZone, utcMs) * 60_000;
  return utcMs;
}

export type PrtgFetchLike = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

function connectionTimeoutMs(connection: PrtgConnection): number {
  const value = connection.requestTimeoutMs;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : PRTG_TIMEOUT_MS;
}

// Optional DI token so specs can inject a fake transport; production leaves
// it unbound and the client uses the fetch bound to the validated target.
export const PRTG_FETCH_IMPLEMENTATION = 'PRTG_FETCH_IMPLEMENTATION';

function textOrNull(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

export function finiteNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// Strips query strings from URL-ish tokens and masks auth-bearing query
// parameters in free-form error text (defense in depth: transport errors can
// embed the request URL, and the PRTG token lives in the query string).
export function sanitizePrtgText(value: string): string {
  return String(value || '')
    .replace(/(apitoken|passhash|username|password)=[^&\s"')]*/gi, '$1=***')
    .replace(/\?[^\s"')]*/g, '');
}

// Converts a PRTG OLE automation date (server-local wall clock) to a UTC ISO
// string, applying the configured server timezone (default UTC, DST-correct).
export function oleAutomationDateToUtcIso(raw: unknown, serverTimeZone?: string | null): string | null {
  const value = finiteNumberOrNull(raw);
  if (value == null || value <= 0) {
    return null;
  }
  const wallMs = Math.round((value - OLE_AUTOMATION_EPOCH_UNIX_DAYS) * MS_PER_DAY);
  const zone = normalizeZone(serverTimeZone);
  const utcMs = zone === 'UTC' ? wallMs : wallClockMsToUtcMs(wallMs, zone);
  return new Date(utcMs).toISOString();
}

// Converts a relative-duration `_raw` column (seconds, e.g. downtimesince_raw)
// into an absolute UTC ISO timestamp anchored to the fetch time. Rounded to
// the full minute so successive polls of the SAME occurrence produce a stable
// timestamp — occurrence dedup keys embed this value (plan 37 D4).
// A zero duration means PRTG tracks NO transition for the state (it reports
// downtimesince_raw=0 for states without a "down since", e.g. warning or
// unusual): treated as "occurrence start unknown" (null). Anchoring it at
// fetch time instead would drift by one poll interval per cycle and make
// every cycle look like a new occurrence (re-diagnosed and re-billed).
export function relativeSecondsToUtcIso(nowMs: number, rawSeconds: unknown): string | null {
  const seconds = finiteNumberOrNull(rawSeconds);
  if (seconds == null || seconds <= 0) {
    return null;
  }
  const startedMs = Math.round((nowMs - seconds * 1000) / 60_000) * 60_000;
  return new Date(startedMs).toISOString();
}

// Formats a Date as the PRTG sdate/edate parameter (yyyy-MM-dd-HH-mm-ss) in
// PRTG server-local wall-clock time for the configured zone (default UTC).
export function formatPrtgDate(date: Date, serverTimeZone?: string | null): string {
  const wall = wallClockPartsInZone(date.getTime(), normalizeZone(serverTimeZone));
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    String(wall.year),
    pad(wall.month),
    pad(wall.day),
    pad(wall.hour),
    pad(wall.minute),
    pad(wall.second),
  ].join('-');
}

@Injectable()
export class PrtgService {
  private readonly logger = new Logger(PrtgService.name);
  private readonly fetchImpl: PrtgFetchLike | null;

  constructor(@Optional() @Inject(PRTG_FETCH_IMPLEMENTATION) fetchImpl?: PrtgFetchLike) {
    // Null: the default, the fetch bound to the validated target of each call (see requestJson).
    this.fetchImpl = fetchImpl ?? null;
  }

  // GET /api/table.json — sensors/devices/groups listing with column
  // selection, repeatable filters, subtree scoping (id=) and count/start
  // paging. Returns the raw row records under the content key.
  async listObjects(connection: PrtgConnection, request: PrtgTableRequest): Promise<PrtgTableRow[]> {
    const url = this.buildUrl(connection, 'api/table.json', (params) => {
      params.set('content', request.content);
      params.set('columns', request.columns.join(','));
      params.set('count', String(request.count));
      params.set('start', String(request.start));
      params.set('output', 'json');
      if (request.parentObjectId) {
        params.set('id', request.parentObjectId);
      }
      for (const [key, value] of request.filters ?? []) {
        params.append(key, value);
      }
    });
    const payload = await this.requestJson(url, 'table.json', connectionTimeoutMs(connection));
    const rows = isRecord(payload) ? payload[request.content] : null;
    if (!Array.isArray(rows)) {
      throw new PrtgApiError('invalid_response', `PRTG table.json response did not include a ${request.content} row list.`);
    }
    return rows.filter(isRecord);
  }

  // GET /api/getsensordetails.json — single-sensor detail payload
  // (enrichment; the table.json row remains authoritative for raw columns).
  async getSensorDetails(connection: PrtgConnection, sensorId: string): Promise<PrtgSensorDetails> {
    const url = this.buildUrl(connection, 'api/getsensordetails.json', (params) => {
      params.set('id', sensorId);
      params.set('output', 'json');
    });
    const payload = await this.requestJson(url, 'getsensordetails.json', connectionTimeoutMs(connection));
    const sensordata = isRecord(payload) && isRecord(payload.sensordata) ? payload.sensordata : null;
    if (!sensordata) {
      throw new PrtgApiError('invalid_response', 'PRTG getsensordetails.json response was malformed.');
    }
    const name = textOrNull(sensordata.name);
    if (name && /object not found/i.test(name)) {
      throw new PrtgApiError('not_found', `PRTG sensor ${sensorId} was not found.`);
    }
    return sensordata;
  }

  // GET /api/historicdata.json — bounded history window with server-side
  // averaging. The caller is responsible for clamping the window and picking
  // an averaging interval that bounds the point count.
  async getHistoricData(connection: PrtgConnection, request: PrtgHistoricDataRequest): Promise<PrtgHistoricRow[]> {
    const url = this.buildUrl(connection, 'api/historicdata.json', (params) => {
      params.set('id', request.sensorId);
      params.set('avg', String(request.averageIntervalSeconds));
      params.set('sdate', formatPrtgDate(request.startDate, connection.serverTimeZone));
      params.set('edate', formatPrtgDate(request.endDate, connection.serverTimeZone));
      params.set('usecaption', '1');
      params.set('output', 'json');
    });
    const payload = await this.requestJson(url, 'historicdata.json', connectionTimeoutMs(connection));
    const rows = isRecord(payload) ? payload.histdata : null;
    if (!Array.isArray(rows)) {
      throw new PrtgApiError('invalid_response', 'PRTG historicdata.json response did not include a histdata row list.');
    }
    return rows.filter(isRecord);
  }

  // GET /api/sensortypesinuse.json — check-type catalog. Older/limited PRTG
  // instances may not expose it; callers degrade gracefully on
  // not_found/invalid_response.
  async listSensorTypesInUse(connection: PrtgConnection): Promise<PrtgSensorTypeInUse[]> {
    const url = this.buildUrl(connection, 'api/sensortypesinuse.json', (params) => {
      params.set('output', 'json');
    });
    const payload = await this.requestJson(url, 'sensortypesinuse.json', connectionTimeoutMs(connection));
    const record = isRecord(payload) ? payload : {};
    const rows = Array.isArray(record.sensortypes)
      ? record.sensortypes
      : Array.isArray(record.sensortypesinuse)
        ? record.sensortypesinuse
        : null;
    if (!rows) {
      throw new PrtgApiError('invalid_response', 'PRTG sensortypesinuse.json response was malformed.');
    }
    return rows
      .filter(isRecord)
      .map((row) => ({
        id: textOrNull(row.id ?? row.kind) ?? '',
        name: textOrNull(row.name) ?? '',
      }))
      .filter((type) => type.id.length > 0 && type.name.length > 0);
  }

  // Minimal connectivity probe for the admin "test connection" button: one
  // table.json request (count=1) with a short timeout. Returns the reported
  // PRTG version and the visible sensor count (treesize); throws PrtgApiError
  // with sanitized messages like every other endpoint.
  async testConnection(connection: PrtgConnection): Promise<{ prtgVersion: string | null; sensorCount: number | null }> {
    const url = this.buildUrl(connection, 'api/table.json', (params) => {
      params.set('content', 'sensors');
      params.set('columns', 'objid');
      params.set('count', '1');
      params.set('start', '0');
      params.set('output', 'json');
    });
    const payload = await this.requestJson(url, 'table.json', connection.requestTimeoutMs ?? PRTG_TEST_TIMEOUT_MS);
    const record = isRecord(payload) ? payload : {};
    if (!Array.isArray(record.sensors)) {
      throw new PrtgApiError('invalid_response', 'PRTG table.json response did not include a sensors row list.');
    }
    return {
      prtgVersion: textOrNull(record['prtg-version']),
      sensorCount: finiteNumberOrNull(record.treesize) ?? record.sensors.length,
    };
  }

  private buildUrl(
    connection: PrtgConnection,
    path: string,
    fill: (params: URLSearchParams) => void,
  ): string {
    const base = connection.baseUrl.replace(/\/+$/, '');
    let url: URL;
    try {
      url = new URL(`${base}/${path}`);
    } catch {
      throw new PrtgApiError('provider_unavailable', 'PRTG base URL is not a valid absolute URL.');
    }
    fill(url.searchParams);
    if (connection.auth.kind === 'api_token') {
      url.searchParams.set('apitoken', connection.auth.apiToken);
    } else {
      url.searchParams.set('username', connection.auth.username);
      url.searchParams.set('passhash', connection.auth.passhash);
    }
    return url.toString();
  }

  private async requestJson(url: string, endpoint: string, timeoutMs = PRTG_TIMEOUT_MS): Promise<unknown> {
    // SSRF guard: block internal targets in multi-tenant cloud (no-op on-prem where
    // a private PRTG base URL is legitimate). DNS-checked at request time, not only at
    // config save, and the connection then goes to the validated addresses only;
    // redirect:'error' in cloud additionally stops a public host 302-ing to an
    // internal one after this check. The connection is released once the body is read.
    const target = await openValidatedFetch(url);
    try {
      return await this.readJson(target.fetch, url, endpoint, timeoutMs);
    } finally {
      await target.close();
    }
  }

  private async readJson(boundFetch: typeof fetch, url: string, endpoint: string, timeoutMs: number): Promise<unknown> {
    // Default fetch: a redirect is an error in cloud (followed on-prem).
    const fetchImpl: PrtgFetchLike = this.fetchImpl
      ?? ((input, init) => boundFetch(input, { ...init, redirect: Features.SINGLE_TENANT ? 'follow' : 'error' }));
    let response: Response;
    try {
      response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (error: any) {
      const name = String(error?.name || '');
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new PrtgApiError('timeout', `PRTG ${endpoint} request timed out after ${timeoutMs}ms.`, true);
      }
      throw new PrtgApiError(
        'provider_unavailable',
        `PRTG ${endpoint} request failed: ${sanitizePrtgText(String(error?.message || error || 'request failed'))}`,
        true,
      );
    }
    const raw = await response.text();
    if (!response.ok) {
      throw this.httpError(response.status, endpoint);
    }
    const text = String(raw || '').trim();
    if (!text) {
      return {};
    }
    try {
      return JSON.parse(text);
    } catch {
      this.logger.warn(`PRTG returned non-JSON content for ${endpoint} (HTTP ${response.status})`);
      if (text.startsWith('<!DOCTYPE') || text.startsWith('<html') || text.startsWith('<')) {
        throw new PrtgApiError(
          'invalid_response',
          `PRTG ${endpoint} returned HTML instead of JSON. Check that the base URL points at the PRTG web server and the classic API is enabled.`,
        );
      }
      throw new PrtgApiError('invalid_response', `PRTG ${endpoint} returned a non-JSON response.`);
    }
  }

  private httpError(status: number, endpoint: string): PrtgApiError {
    if (status === 401) {
      return new PrtgApiError('unauthorized', `PRTG ${endpoint} request was unauthorized (HTTP 401). Check the API token or username/passhash credential.`);
    }
    if (status === 403) {
      return new PrtgApiError('forbidden', `PRTG ${endpoint} request was forbidden (HTTP 403). The PRTG account lacks access to this object.`);
    }
    if (status === 404) {
      return new PrtgApiError('not_found', `PRTG ${endpoint} resource was not found (HTTP 404).`);
    }
    if (status === 429) {
      return new PrtgApiError('rate_limited', `PRTG ${endpoint} request was rate limited (HTTP 429).`, true);
    }
    if (status >= 500) {
      return new PrtgApiError('provider_unavailable', `PRTG ${endpoint} request failed with HTTP ${status}.`, true);
    }
    return new PrtgApiError('invalid_response', `PRTG ${endpoint} request failed with HTTP ${status}.`);
  }
}
