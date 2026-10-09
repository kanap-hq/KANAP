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
 *   `after_json = { resource, path, ip, user_agent }` (export-events.interceptor.ts): every route whose path ends
 *   with `/export`, and the other routes that send a file the server produces, marked
 *   `@ExportRoute()`.
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

/**
 * The audit row of an export: the route's resource, the path asked for without its query
 * (500 characters at most), and the client address and user agent (authEventDetails).
 */
export function exportEventEntry(
  routePath: string,
  req: ({ path?: unknown; user?: { sub?: unknown } } & NonNullable<RequestLike>) | null | undefined,
): AuditEntry {
  const userId = typeof req?.user?.sub === 'string' && req.user.sub ? req.user.sub : null;
  const path = (typeof req?.path === 'string' && req.path ? req.path : routePath).slice(0, 500);
  return {
    table: EXPORT_EVENT_TABLE,
    recordId: null,
    action: EXPORT_EVENT_ACTION,
    before: null,
    after: { resource: exportResource(routePath), path, ...authEventDetails(req) },
    userId,
    source: 'user',
    sourceRef: null,
  };
}
