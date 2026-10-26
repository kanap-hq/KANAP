import { isIP } from 'node:net';
import { SetMetadata } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { clientAddress } from '../common/client-address';
import type { AuditEntry } from './audit.service';

/**
 * Security events in the tenant's audit log (`audit_log`), next to the data changes:
 * - sign-in and session events: `table_name = 'auth'`, one of AUTH_EVENT_ACTIONS, the account in
 *   `record_id` and `user_id` when the request named a known one, a short code in `source_ref`
 *   (AUTH_EVENT_REASONS), and `after_json = { ip, user_agent }`. Nothing else: no password, token,
 *   hash or link, and no e-mail address (an attempt on an unknown address keeps its reason only).
 *   Kept AUTH_EVENT_RETENTION_DAYS days (cleanup/auth-event-retention.service.ts);
 * - exports: `table_name = 'export'`, `action = 'export'`, the person in `user_id`, and
 *   `after_json = { resource, path, format, query, ip, user_agent }`, plus `rows` when the handler
 *   reports how many rows it exported (`recordExportRows`) (export-events.interceptor.ts): every
 *   route whose path ends with `/export`, and the other routes that send a file the server
 *   produces, marked `@ExportRoute()`. Never the request body.
 */

export const AUTH_EVENT_TABLE = 'auth';
export const EXPORT_EVENT_TABLE = 'export';
export const EXPORT_EVENT_ACTION = 'export';

/** Sign-in and session events are deleted from the audit log after this many days. */
export const AUTH_EVENT_RETENTION_DAYS = 365;

/** The user agent is cut to this many characters. */
export const USER_AGENT_MAX_LENGTH = 200;

/** The longest text form of an IP address (an IPv6 address that ends with an IPv4 one). */
export const IP_ADDRESS_MAX_LENGTH = 45;

export const AUTH_EVENT_ACTIONS = [
  'login',
  'login_failed',
  'logout',
  'refresh_denied',
  'password_reset_requested',
  'password_reset_completed',
  'sso_login',
  'sso_login_failed',
  /** The account refused to connect an MCP client (OAuth consent screen, ai/oauth). */
  'mcp_connection_refused',
] as const;
export type AuthEventAction = (typeof AUTH_EVENT_ACTIONS)[number];

/** The codes `source_ref` may hold: why a request was refused, or how a sign-in was made. */
export const AUTH_EVENT_REASONS = [
  /** Wrong password for a known account. */
  'bad_password',
  /** No account with this address in the tenant (the address is not kept). */
  'unknown_user',
  /** The account has no local password (single sign-on account, invitation not accepted yet). */
  'no_password',
  /** The account is disabled. */
  'disabled',
  /** The account's role cannot sign in (Contact, or no role). */
  'not_allowed',
  /** A session, link or hand-off that is unknown, already used, malformed or signed by another key. */
  'invalid_token',
  /** A session past its end. */
  'expired',
  /** A password reset asked for an account the directory manages (no local password). */
  'external_account',
  /** A password reset for a known account whose e-mail could not be sent (the server log says why). */
  'email_not_sent',
  /** Single sign-on: the directory or the tenant does not match the one the workspace is bound to. */
  'tenant_mismatch',
  /** Single sign-on is not set up for the workspace. */
  'sso_not_configured',
  /** Single sign-on: the directory says the account's address is not verified. */
  'email_unverified',
  /** Single sign-on: the sign-in round trip came back without a valid state. */
  'invalid_state',
  /** Single sign-on failed for another reason (the provider's message is not kept). */
  'sso_failed',
  /** A sign-in through the provisioning token exchange. */
  'provisioning',
  /** Password sign-in refused before the password check: too many attempts for the account from this address. */
  'too_many_attempts',
] as const;
export type AuthEventReason = (typeof AUTH_EVENT_REASONS)[number];

const KNOWN_ACTIONS: ReadonlySet<string> = new Set(AUTH_EVENT_ACTIONS);
const KNOWN_REASONS: ReadonlySet<string> = new Set(AUTH_EVENT_REASONS);

export type AuthEvent = {
  action: AuthEventAction;
  /** The account, when the request named a known one. */
  userId?: string | null;
  reason?: AuthEventReason | null;
};

type RequestLike = { ip?: unknown; headers?: Record<string, unknown> } | null | undefined;

/**
 * The client address (common/client-address.ts) when it is a valid IPv4 or IPv6 address of at most
 * IP_ADDRESS_MAX_LENGTH characters (null otherwise), and the user agent, cut to USER_AGENT_MAX_LENGTH.
 */
export function authEventDetails(req: RequestLike): { ip: string | null; user_agent: string | null } {
  const raw = req?.headers?.['user-agent'];
  const agent = typeof raw === 'string' ? raw.trim().slice(0, USER_AGENT_MAX_LENGTH) : '';
  const address = clientAddress(req);
  const ip = address && address.length <= IP_ADDRESS_MAX_LENGTH && isIP(address) !== 0 ? address : null;
  return { ip, user_agent: agent || null };
}

/**
 * The audit row of an authentication event, or null for an action outside AUTH_EVENT_ACTIONS.
 * A reason outside AUTH_EVENT_REASONS is left out.
 */
export function authEventEntry(event: AuthEvent, req: RequestLike): AuditEntry | null {
  if (!KNOWN_ACTIONS.has(event?.action)) return null;
  const userId = typeof event.userId === 'string' && event.userId ? event.userId : null;
  const reason = typeof event.reason === 'string' && KNOWN_REASONS.has(event.reason) ? event.reason : null;
  return {
    table: AUTH_EVENT_TABLE,
    recordId: userId,
    action: event.action,
    before: null,
    after: authEventDetails(req),
    userId,
    source: 'user',
    sourceRef: reason,
  };
}

// ---------------------------------------------------------------------------------------------
// Export routes

function pathList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return typeof value === 'string' ? [value] : [''];
}

/** `suppliers` + `export` → `/suppliers/export`; `export` + `/` → `/export`. */
export function joinRoutePath(controllerPath: string, handlerPath: string): string {
  const joined = `/${controllerPath}/${handlerPath}`.replace(/\/+/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
}

/** The route patterns of a controller method, from Nest's route metadata (the API has no global prefix). */
export function handlerRoutePaths(controller: object, handler: object): string[] {
  const out: string[] = [];
  for (const base of pathList(Reflect.getMetadata(PATH_METADATA, controller))) {
    for (const own of pathList(Reflect.getMetadata(PATH_METADATA, handler))) out.push(joinRoutePath(base, own));
  }
  return out;
}

/** An export route: its path ends with the segment `export` (`/suppliers/export`, `/knowledge/:idOrRef/export`, `/export`). */
export function isExportRoutePath(path: string): boolean {
  return /(^|\/)export$/.test(path);
}

export const EXPORT_ROUTE_METADATA = 'kanap:export-route';

/**
 * Marks a route that sends a file the server produces (a report, a document) although its path
 * does not end with `/export` (`GET /incidents/:id/report`): ExportEventsInterceptor records it
 * like the export routes.
 */
export const ExportRoute = (): MethodDecorator => SetMetadata(EXPORT_ROUTE_METADATA, true);

export const EXPORT_FORMAT_METADATA = 'kanap:export-format';

/**
 * The format of the file a route sends when the request names none (`pdf` for the PDF report of
 * an incident or a document): written on its export row. A route without it is recorded as `csv`.
 */
export const ExportRouteFormat = (format: string): MethodDecorator => SetMetadata(EXPORT_FORMAT_METADATA, format);

/** The format a controller method declares with `@ExportRouteFormat()`, if any. */
export function declaredExportFormat(handler: object): string | undefined {
  const format = Reflect.getMetadata(EXPORT_FORMAT_METADATA, handler);
  return typeof format === 'string' && format ? format : undefined;
}

/**
 * The route pattern an export of this controller method is recorded under: its path ending with
 * `/export`, or its path when the method is marked `@ExportRoute()`. Undefined for other routes.
 */
export function exportRoutePath(controller: object, handler: object): string | undefined {
  const paths = handlerRoutePaths(controller, handler);
  const exportPath = paths.find(isExportRoutePath);
  if (exportPath) return exportPath;
  return Reflect.getMetadata(EXPORT_ROUTE_METADATA, handler) === true ? paths[0] : undefined;
}

/**
 * What a route exports: its segments, parameters and a final `export` left out
 * (`/chart-of-accounts/:id/accounts/export` → `chart-of-accounts/accounts`,
 * `/incidents/:id/report` → `incidents/report`); `document` for the document export route
 * (`POST /export`).
 */
export function exportResource(path: string): string {
  const segments = path.split('/').filter((segment) => segment && !segment.startsWith(':'));
  if (segments[segments.length - 1] === 'export') segments.pop();
  return segments.join('/') || 'document';
}

/** The query of an export row is at most this long once serialised. */
export const EXPORT_QUERY_MAX_LENGTH = 2_000;
const EXPORT_FORMAT_MAX_LENGTH = 20;

/**
 * Set by ListContextInterceptor before it merges a saved list context into the query: the query as
 * the client sent it, whose `ctx` names the context.
 */
export const QUERY_AS_SENT = Symbol('kanap.queryAsSent');

type ExportRequest = ({
  path?: unknown;
  user?: { sub?: unknown };
  query?: unknown;
  body?: unknown;
  [QUERY_AS_SENT]?: unknown;
} & NonNullable<RequestLike>) | null | undefined;

function formatValue(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase().slice(0, EXPORT_FORMAT_MAX_LENGTH);
  return value || null;
}

/**
 * The format of an export: the `format` query, else the `format` field of the body (the document
 * exports, `POST /export` and `POST /knowledge/:idOrRef/export`, take it there), lower case, else
 * the format the route declares (`@ExportRouteFormat`), else `csv`.
 */
export function exportFormat(req: ExportRequest, declared?: string): string {
  const query = req?.[QUERY_AS_SENT] ?? req?.query;
  const body = req?.body;
  return (
    formatValue(query && typeof query === 'object' ? (query as Record<string, unknown>).format : undefined)
    ?? formatValue(body && typeof body === 'object' ? (body as Record<string, unknown>).format : undefined)
    ?? declared
    ?? 'csv'
  );
}

function queryValue(raw: unknown): string | string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (Array.isArray(raw)) return raw.map((item) => (typeof item === 'string' ? item : JSON.stringify(item) ?? String(item)));
  if (typeof raw === 'object') return JSON.stringify(raw);
  return String(raw);
}

function sortedObject(entries: Array<[string, unknown]>): Record<string, unknown> {
  return Object.fromEntries([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * The query of an export as the client sent it (`ctx` stays the id of the saved list context):
 * keys sorted, values as strings or lists of strings. At most EXPORT_QUERY_MAX_LENGTH characters
 * once serialised: the longest entries are dropped first, and `truncated: true` says so.
 */
export function exportQuery(raw: unknown): Record<string, unknown> {
  const entries: Array<[string, string | string[]]> = [];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const kept = queryValue(value);
      if (kept !== undefined) entries.push([key, kept]);
    }
  }
  const whole = sortedObject(entries);
  if (JSON.stringify(whole).length <= EXPORT_QUERY_MAX_LENGTH) return whole;
  const size = ([key, value]: [string, unknown]) => JSON.stringify(key).length + JSON.stringify(value).length;
  // Longest first; on a tie, the later key first, so the result does not depend on the input order.
  const longestFirst = [...entries].sort((a, b) => size(b) - size(a) || (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
  const kept = new Map(entries);
  for (const [key] of longestFirst) {
    kept.delete(key);
    kept.delete('truncated');
    const next = sortedObject([...kept.entries(), ['truncated', true]]);
    if (JSON.stringify(next).length <= EXPORT_QUERY_MAX_LENGTH) return next;
  }
  return { truncated: true };
}

/**
 * The audit row of an export: the route's resource, the path asked for without its query
 * (500 characters at most), the format (exportFormat), the query (exportQuery), and the client
 * address and user agent (authEventDetails).
 */
export function exportEventEntry(routePath: string, req: ExportRequest, declaredFormat?: string): AuditEntry {
  const userId = typeof req?.user?.sub === 'string' && req.user.sub ? req.user.sub : null;
  const path = (typeof req?.path === 'string' && req.path ? req.path : routePath).slice(0, 500);
  return {
    table: EXPORT_EVENT_TABLE,
    recordId: null,
    action: EXPORT_EVENT_ACTION,
    before: null,
    after: {
      resource: exportResource(routePath),
      path,
      format: exportFormat(req, declaredFormat),
      query: exportQuery(req?.[QUERY_AS_SENT] ?? req?.query),
      ...authEventDetails(req),
    },
    userId,
    source: 'user',
    sourceRef: null,
  };
}

const EXPORT_ROWS = Symbol('kanap.exportRows');

/**
 * Called by an export's handler once it knows how many rows it exported: ExportEventsInterceptor
 * writes the count on the request's export row (`after_json.rows`), in the request transaction,
 * after the handler. Rows are absent from the row of an export that does not call it.
 */
export function recordExportRows(req: unknown, count: number): void {
  if (!req || typeof req !== 'object') return;
  if (!Number.isSafeInteger(count) || count < 0) return;
  (req as { [EXPORT_ROWS]?: number })[EXPORT_ROWS] = count;
}

/** The count a handler reported with recordExportRows, if any. */
export function reportedExportRows(req: unknown): number | undefined {
  if (!req || typeof req !== 'object') return undefined;
  const count = (req as { [EXPORT_ROWS]?: unknown })[EXPORT_ROWS];
  return typeof count === 'number' ? count : undefined;
}
