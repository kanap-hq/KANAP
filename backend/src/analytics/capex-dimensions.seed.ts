import { EntityManager } from 'typeorm';

/**
 * The three CAPEX dimensions the tenants created before the recommended dimensions received
 * (plan planning/budget-unifie.md, lot C1): the PP&E type, the investment type and the priority
 * of a CAPEX line, as ordinary analytics dimensions with fixed codes. Used for CAPEX lines,
 * required, enabled, their values in their business order. Those tenants keep them; an
 * administrator may rename, extend, disable or delete them like any other.
 *
 * A frozen table: new tenants get the recommended dimensions instead
 * (`recommended-dimensions.seed.ts`). Migration 1853980000000 gave the tenants of its time the
 * same dimensions with its own copy of this table and of the SQL below; a spec checks both copies
 * are equal. The sample data's empty-space check still accepts these values, and specs use
 * `ensureCapexDimensions` to build a tenant with the three dimensions.
 */

/** The languages the names exist in: English only (the table is frozen). */
export type CapexDimensionLanguage = 'en';

export const CAPEX_DIMENSION_LANGUAGES: readonly CapexDimensionLanguage[] = ['en'];

type Names = Readonly<Record<CapexDimensionLanguage, string>>;

export interface CapexDimensionDefinition {
  /** The dimension's fixed code: the budget file's `analytics:<code>` column. */
  code: 'ppe_type' | 'investment_type' | 'priority';
  name: Names;
  /**
   * The values in their order (`sort_order` 1..n on a new dimension). `key` names the value
   * stably across languages: the code the CAPEX line stored before lot C1.
   */
  values: ReadonlyArray<{ key: string; name: Names }>;
}

export const CAPEX_DIMENSIONS: readonly CapexDimensionDefinition[] = [
  {
    code: 'ppe_type',
    name: { en: 'PP&E type' },
    values: [
      { key: 'hardware', name: { en: 'Hardware' } },
      { key: 'software', name: { en: 'Software' } },
    ],
  },
  {
    code: 'investment_type',
    name: { en: 'Investment type' },
    values: [
      { key: 'replacement', name: { en: 'Replacement' } },
      { key: 'capacity', name: { en: 'Capacity' } },
      { key: 'productivity', name: { en: 'Productivity' } },
      { key: 'security', name: { en: 'Security' } },
      { key: 'conformity', name: { en: 'Conformity' } },
      { key: 'business_growth', name: { en: 'Business growth' } },
      { key: 'other', name: { en: 'Other' } },
    ],
  },
  {
    code: 'priority',
    name: { en: 'Priority' },
    values: [
      { key: 'mandatory', name: { en: 'Mandatory' } },
      { key: 'high', name: { en: 'High' } },
      { key: 'medium', name: { en: 'Medium' } },
      { key: 'low', name: { en: 'Low' } },
    ],
  },
];

/** One dimension of the table in one language: code, name, values in order. */
export interface CapexDimensionSeed {
  code: string;
  name: string;
  values: Array<{ key: string; name: string }>;
}

/** The table in one language. */
export function capexDimensionTable(language: CapexDimensionLanguage = 'en'): CapexDimensionSeed[] {
  return CAPEX_DIMENSIONS.map((dimension) => ({
    code: dimension.code,
    name: dimension.name[language],
    values: dimension.values.map((value) => ({ key: value.key, name: value.name[language] })),
  }));
}

/**
 * The statements of the seed, the same in migration 1853980000000. Every one names its tenant
 * (`$1`) besides row level security. Positions never overflow an int (`LEAST`).
 */
export const CAPEX_DIMENSION_SQL = {
  /** The tenant's dimension of a code (unique per tenant, case-insensitive), whatever its settings. */
  findAxis: `SELECT id::text AS id, name, applies_to, required, status::text AS status, sort_order
       FROM analytics_axes
      WHERE tenant_id = $1 AND lower(code) = lower($2)`,
  /** Whether a dimension of the tenant already has the name (unique per tenant, case-insensitive). */
  nameTaken: `SELECT EXISTS (SELECT 1 FROM analytics_axes WHERE tenant_id = $1 AND lower(name) = lower($2)) AS taken`,
  /** A new CAPEX dimension, after the tenant's last one (D4): used for CAPEX lines, required, enabled. */
  insertAxis: `INSERT INTO analytics_axes (tenant_id, code, name, sort_order, applies_to, required, status)
     SELECT $1, $2, $3, LEAST(coalesce(max(a.sort_order), 0)::bigint + 1, 2147483647)::int, 'capex', true, 'enabled'
       FROM analytics_axes a
      WHERE a.tenant_id = $1
     ON CONFLICT DO NOTHING
     RETURNING id::text AS id`,
  /** A value the dimension lacks (by name, case-insensitive), after its last one (D3), for both line types. */
  insertValue: `INSERT INTO analytics_categories (tenant_id, axis_id, name, sort_order, status)
     SELECT $1, $2, $3, LEAST(coalesce(max(c.sort_order), 0)::bigint + 1, 2147483647)::int, 'enabled'
       FROM analytics_categories c
      WHERE c.tenant_id = $1 AND c.axis_id = $2
     HAVING NOT coalesce(bool_or(lower(c.name) = lower($3)), false)
     ON CONFLICT DO NOTHING
     RETURNING id::text AS id`,
} as const;

/** The names a new dimension tries, in order, while a dimension of the tenant holds one. */
export function capexDimensionNameCandidate(name: string, attempt: number): string {
  if (attempt === 0) return name;
  return attempt === 1 ? `${name} (CAPEX)` : `${name} (CAPEX ${attempt})`;
}

/** What the seed did for one dimension of a tenant. */
export interface CapexDimensionOutcome {
  code: string;
  axisId: string;
  /** False when the tenant already had a dimension of that code: kept as it is, its settings untouched. */
  created: boolean;
  /** The name it has (the table's, or with " (CAPEX)" when another dimension held it). */
  name: string | null;
  valuesCreated: number;
}

type Query = (sql: string, params: unknown[]) => Promise<any[]>;

/**
 * Creates the CAPEX dimensions and values a tenant lacks: a dimension by its code, a value by its
 * name in that dimension. A dimension of that code already there is kept as it is (name and
 * settings untouched) and only gets the values it lacks. Idempotent; runs in the caller's
 * transaction, with `app.current_tenant` set to the tenant (the value trigger writes the search
 * index under row level security).
 */
export async function ensureCapexDimensions(
  manager: EntityManager,
  tenantId: string,
  language: CapexDimensionLanguage = 'en',
): Promise<CapexDimensionOutcome[]> {
  const query: Query = (sql, params) => manager.query(sql, params);
  const outcomes: CapexDimensionOutcome[] = [];
  for (const dimension of capexDimensionTable(language)) {
    outcomes.push(await ensureCapexDimension(query, tenantId, dimension));
  }
  return outcomes;
}

async function ensureCapexDimension(query: Query, tenantId: string, dimension: CapexDimensionSeed): Promise<CapexDimensionOutcome> {
  let created = false;
  let [axis] = await query(CAPEX_DIMENSION_SQL.findAxis, [tenantId, dimension.code]);
  if (!axis) {
    let name = dimension.name;
    for (let attempt = 0; ; attempt += 1) {
      name = capexDimensionNameCandidate(dimension.name, attempt);
      const [{ taken }] = await query(CAPEX_DIMENSION_SQL.nameTaken, [tenantId, name]);
      if (!taken) break;
    }
    const [inserted] = await query(CAPEX_DIMENSION_SQL.insertAxis, [tenantId, dimension.code, name]);
    created = !!inserted;
    [axis] = await query(CAPEX_DIMENSION_SQL.findAxis, [tenantId, dimension.code]);
    if (!axis) throw new Error(`The ${dimension.code} dimension could not be created.`);
  }
  let valuesCreated = 0;
  for (const value of dimension.values) {
    const rows = await query(CAPEX_DIMENSION_SQL.insertValue, [tenantId, axis.id, value.name]);
    valuesCreated += rows.length;
  }
  return { code: dimension.code, axisId: axis.id, created, name: axis.name ?? null, valuesCreated };
}
