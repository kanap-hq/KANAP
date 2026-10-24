import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NodeSpec, PgClient, seedNodes, seedPerson, seedRole } from './data-access-test-helpers';

/**
 * The reference example of the line specs (planning/data-scoped-access/spec.md §2.2-2.5), shared
 * by data-access-line-policies.spec.ts (run 2A) and data-access-links-tasks.spec.ts (run 2B).
 *
 * Companies Alpha France (FR) and Alpha Espagne (ES); group Infrastructure (INF) with INF-FR (FR)
 * and INF-ES (ES). Lines:
 *   L1 FR / INF-FR   L2 FR / INF-ES   L3 ES / INF-FR (paid by another company than its centre's)
 *   L4 ES / INF-ES   L5 ES / no centre   L6 no company, no centre, Nina IT owner
 *   L7 no company, no centre, Nina business owner (its only named owner)
 * Persons (limited unless said): Marta (ES edit), Paul (INF read), Rita (INF-FR edit + INF read),
 * Claire (all, edit), Rob (all, read), Nina (no node), an Administrator (limited mode, role
 * Administrator: everything), Ulla (mode all).
 */

let itemNumber = 1000;

/** A fresh item number for a line of the seeded tenant. */
export function nextItemNumber(): number {
  return itemNumber++;
}

/** data_access_apply() for this person; returns the mode it set. */
export async function applyPerson(client: PgClient, userId: string): Promise<string> {
  return (await client.query(`SELECT data_access_apply($1) AS mode`, [userId])).rows[0].mode;
}

export type Label = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7';
export const LABELS: Label[] = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'];

export type Seed = {
  tenantId: string;
  fr: string;
  es: string;
  inf: string;
  infFr: string;
  infEs: string;
  lines: Record<Label, string>;
  versions: Record<Label, string>;
  roundInputs: Record<Label, string>;
  contact2: string;
  axis2: string;
  category2: string;
  persons: Record<'marta' | 'paul' | 'rita' | 'claire' | 'rob' | 'nina' | 'admin' | 'ulla', string>;
};



/** Inside the caller's transaction: the tenant (app.current_tenant set to it), its lines and persons. */
export async function seed(client: PgClient): Promise<Seed> {
  const q = async (sql: string, params?: unknown[]): Promise<any[]> => (await client.query(sql, params)).rows;
  const tenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  await q(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `da-lines-${tag}`, `Data access lines ${tag}`],
  );
  await q(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const company = async (name: string) => (await q(
    `INSERT INTO companies (tenant_id, name, country_iso, city, status) VALUES ($1, $2, 'FR', 'Lyon', 'enabled') RETURNING id`,
    [tenantId, `${name} ${tag}`],
  ))[0].id as string;
  const fr = await company('Alpha France');
  const es = await company('Alpha Espagne');
  const node = async (code: string, kind: string, parent: string | null, companyId: string | null) => (await q(
    `INSERT INTO cost_centers (tenant_id, code, kind, name, parent_id, company_id, status)
     VALUES ($1, $2, $3, $2, $4, $5, 'enabled') RETURNING id`,
    [tenantId, code, kind, parent, companyId],
  ))[0].id as string;
  const inf = await node('INF', 'group', null, null);
  const infFr = await node('INF-FR', 'cost_center', inf, fr);
  const infEs = await node('INF-ES', 'cost_center', inf, es);

  const member = await seedRole(client, tenantId, 'Budget member');
  const administrator = await seedRole(client, tenantId, 'Administrator');
  const limited = (nodes: NodeSpec[]) => async () => {
    const id = await seedPerson(client, tenantId, 'limited', member);
    await seedNodes(client, tenantId, id, nodes);
    return id;
  };
  const persons = {
    marta: await limited([{ type: 'company', id: es, access: 'edit' }])(),
    paul: await limited([{ type: 'cost_center', id: inf, access: 'read' }])(),
    rita: await limited([
      { type: 'cost_center', id: infFr, access: 'edit' },
      { type: 'cost_center', id: inf, access: 'read' },
    ])(),
    claire: await limited([{ type: 'all', access: 'edit' }])(),
    rob: await limited([{ type: 'all', access: 'read' }])(),
    nina: await limited([])(),
    admin: await seedPerson(client, tenantId, 'limited', administrator),
    ulla: await seedPerson(client, tenantId, 'all', member),
  };

  const contact = async (n: number) => (await q(
    `INSERT INTO contacts (tenant_id, email) VALUES ($1, $2) RETURNING id`, [tenantId, `c${n}-${tag}@example.invalid`],
  ))[0].id as string;
  const contact1 = await contact(1);
  const contact2 = await contact(2);
  const axis = async (code: string) => {
    const axisId = (await q(`INSERT INTO analytics_axes (tenant_id, code, name) VALUES ($1, $2, $2) RETURNING id`, [tenantId, `${code}-${tag}`]))[0].id;
    const categoryId = (await q(`INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, $3) RETURNING id`, [tenantId, axisId, `${code} value`]))[0].id;
    return { axisId: axisId as string, categoryId: categoryId as string };
  };
  const axis1 = await axis('a1');
  const axis2 = await axis('a2');

  const place: Record<Label, [string | null, string | null]> = {
    L1: [fr, infFr], L2: [fr, infEs], L3: [es, infFr], L4: [es, infEs], L5: [es, null], L6: [null, null], L7: [null, null],
  };
  const lines = {} as Record<Label, string>;
  const versions = {} as Record<Label, string>;
  const roundInputs = {} as Record<Label, string>;
  for (const label of LABELS) {
    const [companyId, centreId] = place[label];
    const line = (await q(
      `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, paying_company_id, cost_center_id, owner_it_id, owner_business_id)
       VALUES ($1, $2, 'EUR', '2026-01-01', $3, $4, $5, $6, $7) RETURNING id`,
      [tenantId, `DA line ${label} ${tag}`, nextItemNumber(), companyId, centreId, label === 'L6' ? persons.nina : null, label === 'L7' ? persons.nina : null],
    ))[0].id as string;
    lines[label] = line;
    const version = (await q(
      `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, as_of_date, budget_year)
       VALUES ($1, $2, 'Budget 2026', '2026-01-01', 2026) RETURNING id`, [tenantId, line],
    ))[0].id as string;
    versions[label] = version;
    await q(`INSERT INTO spend_amounts (tenant_id, version_id, period, planned) VALUES ($1, $2, '2026-01-01', 100)`, [tenantId, version]);
    await q(`INSERT INTO spend_allocations (tenant_id, version_id, company_id, allocation_pct) VALUES ($1, $2, $3, 100)`, [tenantId, version, fr]);
    roundInputs[label] = (await q(
      `INSERT INTO spend_round_inputs (tenant_id, version_id, measure, period_start, period_end, method)
       VALUES ($1, $2, 'planned', '2026-01-01', '2026-12-31', 'manual') RETURNING id`, [tenantId, version],
    ))[0].id;
    await q(
      `INSERT INTO spend_round_input_lines (tenant_id, round_input_id, sort, label, quantity_unit, quantity, unit_price, price_basis, frequency, period_start, period_end)
       VALUES ($1, $2, 1, 'Piece', 'pieces', 1, 10, 'per_piece', 'once', '2026-01-01', '2026-12-31')`, [tenantId, roundInputs[label]],
    );
    await q(`INSERT INTO spend_item_analytics_values (tenant_id, item_id, axis_id, category_id) VALUES ($1, $2, $3, $4)`, [tenantId, line, axis1.axisId, axis1.categoryId]);
    await q(`INSERT INTO spend_item_contacts (tenant_id, spend_item_id, contact_id, role) VALUES ($1, $2, $3, 'commercial')`, [tenantId, line, contact1]);
    await q(`INSERT INTO spend_links (tenant_id, spend_item_id, url) VALUES ($1, $2, 'https://example.invalid')`, [tenantId, line]);
    await q(
      `INSERT INTO spend_attachments (tenant_id, spend_item_id, original_filename, stored_filename, storage_path)
       VALUES ($1, $2, 'a.pdf', 'a.pdf', 'spec/a.pdf')`, [tenantId, line],
    );
    await q(`INSERT INTO spend_tasks (tenant_id, item_id, title) VALUES ($1, $2, 'Follow up')`, [tenantId, line]);
  }
  const totals = await q(`SELECT count(*)::int AS n FROM spend_version_totals WHERE tenant_id = $1`, [tenantId]);
  assert.equal(totals[0].n, LABELS.length, 'the amounts trigger wrote one total per version');

  return {
    tenantId, fr, es, inf, infFr, infEs, lines, versions, roundInputs, contact2,
    axis2: axis2.axisId, category2: axis2.categoryId, persons,
  };
}

export type LimitedPerson = 'marta' | 'paul' | 'rita' | 'claire' | 'rob' | 'nina';

/** Lines each limited person reads and modifies. */
export type Expectation = { readable: Label[]; modifiable: Label[] };
export const ALL: Label[] = [...LABELS];
export const EXPECTED: Record<LimitedPerson, Expectation> = {
  // Company ES: the lines it pays, and those of its centre INF-ES (L2); modifies what it pays.
  marta: { readable: ['L2', 'L3', 'L4', 'L5'], modifiable: ['L3', 'L4', 'L5'] },
  // Group INF in read: its centres' lines, not the Spanish line without centre, nothing to modify.
  paul: { readable: ['L1', 'L2', 'L3', 'L4'], modifiable: [] },
  // INF-FR edit inside INF read: the widest access wins on L1; L3 (paid by ES on INF-FR) is read only.
  rita: { readable: ['L1', 'L2', 'L3', 'L4'], modifiable: ['L1'] },
  claire: { readable: ALL, modifiable: ALL },
  rob: { readable: ALL, modifiable: [] },
  // No node: only the lines it owns, as IT owner (L6) or business owner (L7): responsible, read
  // and edit, even without a company.
  nina: { readable: ['L6', 'L7'], modifiable: ['L6', 'L7'] },
};
