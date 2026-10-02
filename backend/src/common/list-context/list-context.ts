import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { createHash } from 'crypto';

/**
 * A list context: the state of a list (its column filters, and any other list
 * parameter) saved under a short id, so a large state travels as `ctx=<id>`
 * instead of tens of kilobytes of query string. "Every supplier but one" on
 * the OPEX list is 31 KB of `filters`: past nginx's 8 KB request line, a page
 * request, a reload of the page or a link opened in a new tab answered 431.
 *
 * The id is content-addressed: the same tenant, list and state always give
 * the same id, so saving a state twice keeps one row. The state is a map of
 * list parameters, the same ones a request would carry inline (`filters`,
 * `sort`, `q`, `status` …); `filters` is kept as an object.
 */

/** Length of a list context id: 22 base64url characters, 132 bits of the SHA-256. */
export const LIST_CONTEXT_ID_LENGTH = 22;
export const LIST_CONTEXT_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** Largest state accepted, serialized: a selection of thousands of values. */
export const MAX_LIST_CONTEXT_STATE_BYTES = 256 * 1024;
const MAX_STATE_KEYS = 40;
const STATE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const LIST_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,127}$/;

/** Unused for this long (days), a list context is purged. */
export const LIST_CONTEXT_RETENTION_DAYS = 90;

export type ListContextValue = string | number | boolean | Array<string | number | boolean> | Record<string, unknown>;
export type ListContextState = Record<string, ListContextValue>;

/** JSON with every object's keys sorted: two equal states serialize the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The id of a state: base64url of SHA-256 over tenant, list and canonical state, first 22 characters. */
export function listContextId(tenantId: string, listKey: string, state: ListContextState): string {
  return createHash('sha256')
    .update(`${tenantId}\n${listKey}\n${canonicalJson(state)}`, 'utf8')
    .digest('base64url')
    .slice(0, LIST_CONTEXT_ID_LENGTH);
}

export function isListContextId(value: unknown): value is string {
  return typeof value === 'string' && LIST_CONTEXT_ID_PATTERN.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

/** The list key a client names its context with (its endpoint, e.g. `spend-items`). */
export function normalizeListKey(raw: unknown): string {
  const key = typeof raw === 'string' ? raw.trim().replace(/^\/+/, '') : '';
  if (!LIST_KEY_PATTERN.test(key)) {
    throw new BadRequestException('A list context needs a list name: letters, digits, "/", "_", "." or "-", at most 128 characters.');
  }
  return key;
}

/**
 * Validates a state sent by a client: an object of list parameters, each a
 * scalar, an array of scalars or (for `filters`) an object. `filters` sent as
 * a JSON string is read as its object, so the same filters give the same id
 * whatever their spelling. Empty values are dropped. Too large: 413.
 */
export function normalizeListContextState(raw: unknown): ListContextState {
  if (!isPlainObject(raw)) throw new BadRequestException('A list context state must be an object of list parameters.');
  const keys = Object.keys(raw);
  if (keys.length > MAX_STATE_KEYS) throw new BadRequestException(`A list context holds at most ${MAX_STATE_KEYS} parameters.`);
  const state: ListContextState = {};
  for (const key of keys) {
    if (!STATE_KEY_PATTERN.test(key) || key === 'ctx') {
      throw new BadRequestException(`"${key}" cannot be a list context parameter.`);
    }
    let value = raw[key];
    if (key === 'filters' && typeof value === 'string') {
      if (!value.trim()) continue;
      try {
        value = JSON.parse(value);
      } catch {
        throw new BadRequestException('The filters of a list context must be a JSON object.');
      }
    }
    if (value === undefined || value === null || value === '') continue;
    if (key === 'filters') {
      if (!isPlainObject(value)) throw new BadRequestException('The filters of a list context must be a JSON object.');
      state[key] = value;
    } else if (isScalar(value)) {
      state[key] = value;
    } else if (Array.isArray(value) && value.every(isScalar)) {
      state[key] = value;
    } else {
      throw new BadRequestException(`The list context parameter "${key}" must be a text, a number, a boolean or a list of them.`);
    }
  }
  if (Buffer.byteLength(canonicalJson(state), 'utf8') > MAX_LIST_CONTEXT_STATE_BYTES) {
    throw new PayloadTooLargeException(`A list context state is limited to ${MAX_LIST_CONTEXT_STATE_BYTES / 1024} KB.`);
  }
  return state;
}

/** A stored value as a query parameter: what the client would have sent inline. */
function asQueryValue(value: unknown): string | string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (isPlainObject(value)) return JSON.stringify(value);
  return String(value);
}

/**
 * The request query once its list context is applied: the stored parameters,
 * then every parameter of the request itself (explicit parameters override the
 * context), without `ctx`. Every parser downstream (`parseListRequest`,
 * `parsePagination`, a service reading `query.filters`) then reads one plain
 * query, as if the client had sent the whole state inline.
 */
export function mergeListContextQuery(state: Record<string, unknown>, query: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state ?? {})) {
    if (key === 'ctx' || value === undefined || value === null) continue;
    merged[key] = asQueryValue(value);
  }
  for (const [key, value] of Object.entries(query ?? {})) {
    if (key === 'ctx' || value === undefined) continue;
    merged[key] = value;
  }
  return merged;
}
