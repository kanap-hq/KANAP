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

/** Names compare without case and without the spaces around them. */
export function applicationNameKey(name: unknown): string {
  return String(name ?? '').trim().toLowerCase();
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

/** 409 `name_taken` when another application of the tenant already has this name. */
export async function assertApplicationNameFree(manager: any, tenantId: string, name: string, excludeId?: string | null): Promise<void> {
  const [holder] = await applicationsNamed(manager, tenantId, name, excludeId);
  if (holder) {
    throw applicationConflict('name_taken', `Another application is already named "${holder.name}" (${holder.ref})`, { name: holder.name, ref: holder.ref });
  }
}

/**
 * The name a copy gets: `requested` when no application has it, else the first free numbered
 * variant. A name ending with a parenthesis (`CRM (copy)`, `CRM (copie)`, whatever the language
 * of the suffix) is numbered inside it (`CRM (copy 2)`); another name gets ` (2)`.
 */
export async function freeApplicationName(manager: any, tenantId: string, requested: string): Promise<string> {
  const inParens = /^(.*\([^()]*?)(?: \d+)?\)$/.exec(requested);
  const stem = inParens ? inParens[1] : requested;
  const variant = (n: number) => (inParens ? `${stem} ${n})` : `${stem} (${n})`);
  const rows: Array<{ name: string }> = await manager.query(
    `SELECT name FROM applications WHERE tenant_id = $1 AND lower(btrim(name)) LIKE $2 ESCAPE '\\'`,
    [tenantId, `${applicationNameKey(stem).replace(/[\\%_]/g, '\\$&')}%`],
  );
  const taken = new Set(rows.map((row) => applicationNameKey(row.name)));
  if (!taken.has(applicationNameKey(requested))) return requested;
  for (let n = 2; ; n += 1) {
    if (!taken.has(applicationNameKey(variant(n)))) return normalizeApplicationName(variant(n));
  }
}

function dayOf(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** 400 `dates_inconsistent` when the end of support or the retirement comes before the go-live. */
export function assertApplicationDates(dates: { go_live_date?: unknown; end_of_support_date?: unknown; retired_date?: unknown }): void {
  const goLive = dayOf(dates.go_live_date);
  if (!goLive) return;
  for (const field of ['end_of_support_date', 'retired_date'] as const) {
    const day = dayOf(dates[field]);
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
