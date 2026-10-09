import { EntityManager } from 'typeorm';
import { isActiveAt } from '../common/status';
import { AxisAppliesTo } from './analytics-axis.entity';

/**
 * Analytics dimensions ("axes" in code): the helpers shared by the dimension
 * and value services, the item write gate, the summary engine and the AI.
 * Every query carries an explicit tenant predicate besides RLS. Read paths
 * never write: a tenant without dimensions reads as "no dimensions"; only
 * write paths create the default dimension (`resolveDefaultAxisId` with
 * `create`), the safety net for tenants inserted without the bootstrap.
 */

export interface AnalyticsAxisInfo {
  id: string;
  code: string;
  name: string | null;
  is_default: boolean;
  /** The budget lines it applies to: OPEX only, CAPEX only, or both (null). */
  applies_to: AxisAppliesTo | null;
  /** The effective state: disabled once the end of validity has passed. */
  status: 'enabled' | 'disabled';
  disabled_at: string | null;
  sort_order: number;
}

/** Engine and grid field key prefix; the key is `analytics_<axis id>` (sort strings split on ':'). */
export const ANALYTICS_FIELD_PREFIX = 'analytics_';
/** CSV header and AI key prefix; the key is `analytics:<axis code>`. */
export const ANALYTICS_CSV_PREFIX = 'analytics:';
export const ANALYTICS_LINK_TABLES = {
  opex: 'spend_item_analytics_values',
  capex: 'capex_item_analytics_values',
} as const;

/** The code the default dimension gets when it is created (it can be renamed later). */
export const DEFAULT_ANALYTICS_AXIS_CODE = 'default';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function analyticsFieldKey(axisId: string): string {
  return `${ANALYTICS_FIELD_PREFIX}${axisId}`;
}

/** The axis id when the field is `analytics_<uuid>`, else null. */
export function parseAnalyticsFieldKey(field: string): string | null {
  if (typeof field !== 'string' || !field.startsWith(ANALYTICS_FIELD_PREFIX)) return null;
  const id = field.slice(ANALYTICS_FIELD_PREFIX.length);
  return UUID_PATTERN.test(id) ? id : null;
}

/** Whether the dimension applies to the lines of `scope` (null: OPEX and CAPEX lines). */
export function axisAppliesTo(axis: { applies_to?: string | null }, scope: 'opex' | 'capex'): boolean {
  return axis.applies_to == null || axis.applies_to === scope;
}

/** Enabled and not past its end of validity. */
export function isAxisActive(
  axis: { status: string; disabled_at: string | Date | null },
  now: Date = new Date(),
): boolean {
  return String(axis.status ?? '').toLowerCase() !== 'disabled' && isActiveAt(axis.disabled_at, now);
}

function toIso(value: Date | string | null): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The tenant's dimensions, disabled included, in display order. */
export async function loadAnalyticsAxes(manager: EntityManager, tenantId: string): Promise<AnalyticsAxisInfo[]> {
  const rows: Array<{
    id: string;
    code: string;
    name: string | null;
    is_default: boolean;
    applies_to: string | null;
    status: string;
    disabled_at: Date | string | null;
    sort_order: number | string;
  }> = await manager.query(
    `SELECT id, code, name, is_default, applies_to, status, disabled_at, sort_order
       FROM analytics_axes
      WHERE tenant_id = $1
      ORDER BY sort_order ASC, lower(coalesce(name, '')) ASC, code ASC, id ASC`,
    [tenantId],
  );
  const now = new Date();
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name ?? null,
    is_default: row.is_default === true,
    applies_to: row.applies_to === 'opex' || row.applies_to === 'capex' ? row.applies_to : null,
    status: isAxisActive(row, now) ? 'enabled' : 'disabled',
    disabled_at: toIso(row.disabled_at),
    sort_order: Number(row.sort_order ?? 0),
  }));
}

/**
 * The tenant's default dimension. With `create`, a missing one is created
 * first (write paths only); without it a tenant with no dimensions reads null.
 */
export async function resolveDefaultAxisId(
  manager: EntityManager,
  tenantId: string,
  opts?: { create?: boolean },
): Promise<string | null> {
  const [row] = await manager.query(
    `SELECT id FROM analytics_axes WHERE tenant_id = $1 AND is_default`,
    [tenantId],
  );
  if (row?.id) return row.id as string;
  if (!opts?.create) return null;
  return ensureDefaultAnalyticsAxis(manager, tenantId);
}

/**
 * Creates the tenant's default dimension when it has none (idempotent, safe
 * under concurrency: the one-default index turns a racing insert into a no-op)
 * and returns its id. Runs in the caller's transaction with the tenant set.
 */
export async function ensureDefaultAnalyticsAxis(manager: EntityManager, tenantId: string): Promise<string> {
  await manager.query(
    `INSERT INTO analytics_axes (tenant_id, code, name, is_default, sort_order)
     VALUES ($1, $2, NULL, true, 0)
     ON CONFLICT DO NOTHING`,
    [tenantId, DEFAULT_ANALYTICS_AXIS_CODE],
  );
  const [row] = await manager.query(
    `SELECT id FROM analytics_axes WHERE tenant_id = $1 AND is_default`,
    [tenantId],
  );
  if (!row?.id) {
    // Only reachable when another dimension already holds the code and no default exists (raw SQL).
    throw new Error('The default analytics dimension could not be created.');
  }
  return row.id as string;
}

/** The label a dimension shows as a heading or a value: its name, or the default label. */
export function analyticsAxisLabel(axis: { name: string | null }): string {
  return axis.name && axis.name.trim() ? axis.name : 'Analytics dimension';
}

/** Inside a sentence: "Nature", or "the analytics dimension" for the default while it has no name. */
export function analyticsAxisInSentence(axis: { name: string | null }): string {
  return axis.name && axis.name.trim() ? axis.name : 'the analytics dimension';
}

/** "the Nature dimension", or "the analytics dimension" for the default while it has no name. */
export function analyticsAxisPhrase(axis: { name: string | null }): string {
  return axis.name && axis.name.trim() ? `the ${axis.name} dimension` : 'the analytics dimension';
}

/** "The Nature dimension" / "The analytics dimension", to open a sentence. */
export function analyticsAxisSubject(axis: { name: string | null }): string {
  const phrase = analyticsAxisPhrase(axis);
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/**
 * The label every screen shows for the unnamed default dimension, in the four
 * app languages. Another dimension cannot take one of them as its name: it
 * would read exactly like the default.
 */
export const DEFAULT_ANALYTICS_AXIS_LABELS = ['Analytics dimension', 'Dimension analytique', 'Analysedimension', 'Dimensión analítica'] as const;

export function isReservedAnalyticsAxisName(name: string): boolean {
  const key = name.trim().toLocaleLowerCase();
  return DEFAULT_ANALYTICS_AXIS_LABELS.some((label) => label.toLocaleLowerCase() === key);
}
