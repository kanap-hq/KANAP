import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditSourceOptions } from '../audit/audit.service';
import { parseEndOfValidityInput, resolveLifecycleState, StatusState } from '../common/status';

/** Every analytics write runs in the caller's tenant transaction. */
export interface AnalyticsContext {
  manager: EntityManager;
  tenantId: string;
  userId?: string | null;
  audit?: AuditSourceOptions;
}

/** The options the older callers pass (AI executors); the tenant is read from the transaction when absent. */
export interface AnalyticsCallOptions {
  manager?: EntityManager;
  tenantId?: string;
  audit?: AuditSourceOptions;
}

export async function resolveAnalyticsContext(
  opts: AnalyticsCallOptions | undefined,
  fallbackManager: EntityManager,
  userId: string | null = null,
): Promise<AnalyticsContext> {
  const manager = opts?.manager ?? fallbackManager;
  let tenantId = opts?.tenantId ?? null;
  if (!tenantId) {
    const [row] = await manager.query(`SELECT app_current_tenant() AS id`);
    tenantId = row?.id ?? null;
  }
  if (!tenantId) throw new InternalServerErrorException('Analytics dimensions need the request transaction.');
  return { manager, tenantId, userId, audit: opts?.audit };
}

export function analyticsRefusal(message: string, field?: string): BadRequestException {
  return new BadRequestException({ statusCode: 400, error: 'Bad Request', message, ...(field ? { field } : {}) });
}

export const ANALYTICS_NAME_MAX = 200;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;

/** A trimmed, non-empty name of 200 characters at most. */
export function normalizeAnalyticsName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : raw == null ? '' : String(raw).trim();
  if (!name) throw analyticsRefusal('Name is required.', 'name');
  if ([...name].length > ANALYTICS_NAME_MAX) {
    throw analyticsRefusal(`Name must be ${ANALYTICS_NAME_MAX} characters or fewer.`, 'name');
  }
  if (CONTROL_OR_FORMAT.test(name)) throw analyticsRefusal('Name cannot contain control or invisible characters.', 'name');
  return name;
}

export function normalizeAnalyticsDescription(raw: unknown): string | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  return text === '' ? null : text;
}

/** Status and end of validity of a body, resolved against the stored end of validity. */
export function resolveAnalyticsLifecycle(
  currentDisabledAt: Date | null,
  body: { status?: unknown; disabled_at?: unknown } | undefined,
): { status: StatusState; disabled_at: Date | null } {
  let nextDisabledAt: Date | null | undefined;
  if (body && Object.prototype.hasOwnProperty.call(body, 'disabled_at') && body.disabled_at !== undefined) {
    try {
      nextDisabledAt = parseEndOfValidityInput(body.disabled_at);
    } catch (err) {
      throw analyticsRefusal((err as Error).message, 'disabled_at');
    }
  }
  let nextStatus: StatusState | undefined;
  if (body?.status !== undefined && body?.status !== null) {
    const status = String(body.status).trim().toLowerCase();
    if (status !== StatusState.ENABLED && status !== StatusState.DISABLED) {
      throw analyticsRefusal("Status must be 'enabled' or 'disabled'.", 'status');
    }
    nextStatus = status as StatusState;
  }
  return resolveLifecycleState({ currentDisabledAt, nextStatus, nextDisabledAt });
}

export const sameInstant = (a: Date | string | null, b: Date | string | null): boolean => {
  const time = (value: Date | string | null) => (value == null ? null : new Date(value).getTime());
  return time(a) === time(b);
};

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "3 OPEX lines and 1 CAPEX line". */
export function lineUsageText(opex: number, capex: number): string {
  const parts: string[] = [];
  if (opex > 0) parts.push(plural(opex, 'OPEX line', 'OPEX lines'));
  if (capex > 0) parts.push(plural(capex, 'CAPEX line', 'CAPEX lines'));
  return parts.join(' and ');
}

/** An UPDATE … RETURNING through the query runner comes back as [rows, count]. */
export function firstReturnedRow<T>(rows: unknown): T | undefined {
  const list = rows as any[];
  if (!Array.isArray(list)) return undefined;
  return (Array.isArray(list[0]) ? list[0][0] : list[0]) as T | undefined;
}
