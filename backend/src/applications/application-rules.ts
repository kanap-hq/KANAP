import { BadRequestException, ConflictException } from '@nestjs/common';

/** The longest application name the API and the import accept. */
export const APPLICATION_NAME_MAX = 200;

type Params = Record<string, string | number>;

/**
 * A refusal with a stable `code` the interface translates (`errors:<code>`), the values its sentence
 * names (`params`) and an English message for the API and the logs.
 */
export function applicationBadRequest(code: string, message: string, params?: Params): BadRequestException {
  return new BadRequestException({ code, message, ...(params ? { params } : {}) });
}

export function applicationConflict(code: string, message: string, params?: Params): ConflictException {
  return new ConflictException({ code, message, ...(params ? { params } : {}) });
}

/** The code and params an error carries, when it has a coded response. */
export function codedErrorOf(error: any): { code?: string; params?: Params } {
  const response = typeof error?.getResponse === 'function' ? error.getResponse() : null;
  if (!response || typeof response !== 'object' || typeof response.code !== 'string') return {};
  return { code: response.code, ...(response.params && typeof response.params === 'object' ? { params: response.params } : {}) };
}

/**
 * Names compare without case and without the spaces around them, as the database compares them
 * (`lower(btrim(name))`): `btrim` removes the space character only, so the key does the same.
 */
export function applicationNameKey(name: unknown): string {
  return String(name ?? '').replace(/^ +| +$/g, '').toLowerCase();
}

/** The trimmed name, or a refusal when it is empty or too long. */
export function normalizeApplicationName(value: unknown): string {
  const name = String(value ?? '').trim();
  if (!name) throw applicationBadRequest('name_required', 'name is required');
  if (name.length > APPLICATION_NAME_MAX) {
    throw applicationBadRequest('name_too_long', `name must be at most ${APPLICATION_NAME_MAX} characters`, { max: APPLICATION_NAME_MAX });
  }
  return name;
}

export type ApplicationNameHolder = { id: string; name: string; ref: string };

/** The applications of the tenant that carry this name (any case, outer spaces ignored), except `excludeId`. */
export async function applicationsNamed(manager: any, tenantId: string, name: string, excludeId?: string | null): Promise<ApplicationNameHolder[]> {
  const rows: Array<{ id: string; name: string; sequential_id: string | null }> = await manager.query(
    `SELECT id::text AS id, name, sequential_id
       FROM applications
      WHERE tenant_id = $1 AND lower(btrim(name)) = $2 AND ($3::uuid IS NULL OR id <> $3::uuid)
      ORDER BY created_at ASC, id ASC`,
    [tenantId, applicationNameKey(name), excludeId ?? null],
  );
  return rows.map((row) => ({ id: row.id, name: row.name, ref: row.sequential_id || row.name }));
}

/**
 * Serializes the name checks of a tenant until the end of the transaction (create, rename, copy,
 * new version, import), so two writers cannot both find a name free.
 */
export async function lockApplicationNames(manager: any, tenantId: string): Promise<void> {
  await manager.query(`SELECT pg_advisory_xact_lock(hashtext('applications:names:' || $1))`, [tenantId]);
}

/**
 * Serializes the suite changes of a tenant until the end of the transaction, so two writers cannot
 * each pass the cycle check (A into B, B into A) and together make a cycle.
 */
export async function lockApplicationSuites(manager: any, tenantId: string): Promise<void> {
  await manager.query(`SELECT pg_advisory_xact_lock(hashtext('applications:suites:' || $1))`, [tenantId]);
}

/** 409 `name_taken` when another application of the tenant already has this name. */
export async function assertApplicationNameFree(manager: any, tenantId: string, name: string, excludeId?: string | null): Promise<void> {
  const [holder] = await applicationsNamed(manager, tenantId, name, excludeId);
  if (holder) {
    throw applicationConflict('name_taken', `Another application is already named "${holder.name}" (${holder.ref})`, { name: holder.name, ref: holder.ref });
  }
}

/**
 * `head` followed by `tail`, with `head` cut so the whole fits in the longest name the API
 * accepts (a copy of a 200-character name, `CRM (copy 2)` of a long `CRM`).
 */
export function fitApplicationName(head: string, tail: string): string {
  return `${head.slice(0, Math.max(0, APPLICATION_NAME_MAX - tail.length)).replace(/ +$/, '')}${tail}`;
}

/**
 * The name a copy gets: `requested` when no application has it, else the first free numbered
 * variant. A name ending with a parenthesis (`CRM (copy)`, `CRM (copie)`, whatever the language
 * of the suffix) is numbered inside it (`CRM (copy 2)`); another name gets ` (2)`. A variant
 * longer than the limit is cut before its suffix.
 */
export async function freeApplicationName(manager: any, tenantId: string, requested: string): Promise<string> {
  const inParens = /^(.*?)( ?\([^()]*?)(?: \d+)?\)$/.exec(requested);
  const head = inParens ? inParens[1] : requested;
  const variant = (n: number) => (inParens ? fitApplicationName(head, `${inParens[2]} ${n})`) : fitApplicationName(head, ` (${n})`));
  // Every variant starts with this much of the head, however much a long number cuts it.
  const prefix = applicationNameKey(head.slice(0, Math.max(0, APPLICATION_NAME_MAX - 24)));
  const rows: Array<{ name: string }> = await manager.query(
    `SELECT name FROM applications WHERE tenant_id = $1 AND lower(btrim(name)) LIKE $2 ESCAPE '\\'`,
    [tenantId, `${prefix.replace(/[\\%_]/g, '\\$&')}%`],
  );
  const taken = new Set(rows.map((row) => applicationNameKey(row.name)));
  if (!taken.has(applicationNameKey(requested))) return requested;
  for (let n = 2; ; n += 1) {
    if (!taken.has(applicationNameKey(variant(n)))) return normalizeApplicationName(variant(n));
  }
}

/**
 * The day of a date, `YYYY-MM-DD`. The database driver reads a `date` column as a `Date` at
 * midnight in the server's zone: its day is read from its local parts, never through
 * `toISOString`, which moves it to the day before east of UTC. A `Date` at midnight UTC
 * (`new Date('2026-05-01')`, what the API makes of a day it receives) is read in UTC.
 */
export function applicationDayOf(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (!(value instanceof Date)) {
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  }
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const utcMidnight = date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
  if (utcMidnight) return date.toISOString().slice(0, 10);
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 400 `dates_inconsistent` when the end of support or the retirement comes before the go-live. */
export function assertApplicationDates(dates: { go_live_date?: unknown; end_of_support_date?: unknown; retired_date?: unknown }): void {
  const goLive = applicationDayOf(dates.go_live_date);
  if (!goLive) return;
  for (const field of ['end_of_support_date', 'retired_date'] as const) {
    const day = applicationDayOf(dates[field]);
    if (day && day < goLive) {
      throw applicationBadRequest('dates_inconsistent', `${field} (${day}) is before go_live_date (${goLive})`, { field, date: day, goLive });
    }
  }
}

/** 409 `suite_has_children` when the application still has child applications attached. */
export async function assertSuiteHasNoChildren(manager: any, tenantId: string, appId: string): Promise<void> {
  const [{ count }] = await manager.query(
    `SELECT count(*)::int AS count FROM application_suites WHERE tenant_id = $1 AND suite_id = $2`,
    [tenantId, appId],
  );
  if (count > 0) {
    throw applicationConflict('suite_has_children', `Detach the ${count} child applications first`, { count });
  }
}

/**
 * 409 `suite_cycle` when the application would belong to itself: one of `suiteIds` is the
 * application, or already belongs to it, directly or through other suites.
 */
export async function assertNoSuiteCycle(manager: any, tenantId: string, appId: string, suiteIds: string[]): Promise<void> {
  if (suiteIds.length === 0) return;
  const [cycle]: Array<{ name: string }> = await manager.query(
    `WITH RECURSIVE inside(id) AS (
       SELECT $2::uuid
       UNION
       SELECT s.application_id FROM application_suites s JOIN inside ON s.suite_id = inside.id WHERE s.tenant_id = $1
     )
     SELECT a.name FROM applications a JOIN inside ON inside.id = a.id
      WHERE a.tenant_id = $1 AND a.id = ANY($3::uuid[])
      ORDER BY a.name ASC LIMIT 1`,
    [tenantId, appId, suiteIds],
  );
  if (cycle) {
    throw applicationConflict('suite_cycle', `This application already contains "${cycle.name}": it cannot belong to it`, { name: cycle.name });
  }
}
