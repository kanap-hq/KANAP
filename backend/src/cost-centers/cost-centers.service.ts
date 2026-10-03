import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { AuditService, AuditSourceOptions } from '../audit/audit.service';
import { parsePagination } from '../common/pagination';
import { isActiveAt, parseEndOfValidityInput, resolveLifecycleState, StatusState } from '../common/status';
import { COST_CENTER_KINDS, CostCenterKind } from './cost-center.entity';
import { CostCenterTreeNode, loadCostCenterTree } from './cost-center-tree.util';
import { assertSetFilterModes } from '../common/ag-grid-filtering';

/** Every call runs in the caller's tenant transaction; there is no fallback manager. */
export interface CostCenterContext {
  manager: EntityManager;
  tenantId: string;
  userId?: string | null;
  audit?: AuditSourceOptions;
}

/** A stored row, as `SELECT *` returns it. */
export interface StoredCostCenter {
  id: string;
  tenant_id: string;
  code: string;
  kind: CostCenterKind;
  name: string;
  description: string | null;
  parent_id: string | null;
  company_id: string | null;
  owner_user_id: string | null;
  status: StatusState;
  disabled_at: Date | null;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

/** The writable values of a node, normalized. */
export interface CostCenterValues {
  code: string;
  kind: CostCenterKind;
  name: string;
  description: string | null;
  parent_id: string | null;
  company_id: string | null;
  owner_user_id: string | null;
  status: StatusState;
  disabled_at: Date | null;
  sort_order: number;
}

export interface CostCenterInput {
  code?: unknown;
  kind?: unknown;
  name?: unknown;
  description?: unknown;
  parent_id?: string | null;
  company_id?: string | null;
  owner_user_id?: string | null;
  status?: unknown;
  disabled_at?: unknown;
  sort_order?: unknown;
}

export type CostCenterListRow = CostCenterTreeNode & { parent_code: string | null; parent_name: string | null };

export type CostCenterDetail = CostCenterListRow & {
  description: string | null;
  opex_count: number;
  capex_count: number;
};

export type CostCenterField = 'code' | 'kind' | 'name' | 'description' | 'parent_id' | 'company_id' | 'owner_user_id' | 'sort_order' | 'disabled_at';

// ------------------------------------------------------------ graph rules ----

export interface CostCenterGraphNode {
  id: string;
  code: string;
  name: string;
  kind: CostCenterKind;
  parent_id: string | null;
  company_id: string | null;
}

export interface CostCenterUsage {
  opex: number;
  capex: number;
}

export interface CostCenterGraphIssue {
  id: string;
  field: 'parent_id' | 'kind' | 'company_id' | 'delete';
  message: string;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function usageText(usage: CostCenterUsage): string {
  const parts: string[] = [];
  if (usage.opex > 0) parts.push(plural(usage.opex, 'OPEX line', 'OPEX lines'));
  if (usage.capex > 0) parts.push(plural(usage.capex, 'CAPEX line', 'CAPEX lines'));
  return parts.join(' and ');
}

const usedByLines = (usage: CostCenterUsage | undefined): usage is CostCenterUsage =>
  !!usage && usage.opex + usage.capex > 0;

/**
 * The tree rules, checked on the tenant's resulting graph (`after`) against
 * the stored one (`before`). One function for create, update, delete and the
 * CSV import:
 *  - a cost center has a company, a group has none;
 *  - only a group can be a parent, never the node itself, and no loop;
 *  - a cost center used by lines cannot become a group, a group holding
 *    nodes cannot become a cost center;
 *  - a node used by lines or holding nodes cannot be removed.
 * `usage` must carry the line counts of every node that is removed or turns
 * from cost center into group. Disabled nodes follow the same rules: a
 * disabled group can still hold nodes.
 */
export function validateCostCenterGraph(input: {
  before: Map<string, CostCenterGraphNode>;
  after: Map<string, CostCenterGraphNode>;
  usage?: Map<string, CostCenterUsage>;
}): CostCenterGraphIssue[] {
  const { before, after } = input;
  const usage = input.usage ?? new Map<string, CostCenterUsage>();
  const issues: CostCenterGraphIssue[] = [];
  const childCount = new Map<string, number>();
  for (const node of after.values()) {
    if (node.parent_id) childCount.set(node.parent_id, (childCount.get(node.parent_id) ?? 0) + 1);
  }

  for (const [id, stored] of before) {
    if (after.has(id)) continue;
    const lines = usage.get(id);
    if (usedByLines(lines)) {
      issues.push({ id, field: 'delete', message: `${stored.code} is used by ${usageText(lines)}. Disable it instead.` });
    }
    const children = childCount.get(id) ?? 0;
    if (children > 0) {
      issues.push({ id, field: 'delete', message: `${stored.name} still contains ${plural(children, 'node', 'nodes')}. Move or delete them first.` });
    }
  }

  for (const [id, node] of after) {
    const stored = before.get(id);
    const changed = !stored
      || stored.parent_id !== node.parent_id
      || stored.kind !== node.kind
      || stored.company_id !== node.company_id;
    if (!changed) continue;

    if (node.kind === 'cost_center' && !node.company_id) {
      issues.push({ id, field: 'company_id', message: 'A cost center needs a company.' });
    }
    if (node.kind === 'group' && node.company_id) {
      issues.push({ id, field: 'company_id', message: 'A group has no company.' });
    }
    if (stored && stored.kind === 'cost_center' && node.kind === 'group') {
      const lines = usage.get(id);
      if (usedByLines(lines)) {
        issues.push({
          id,
          field: 'kind',
          message: `${node.code} is used by ${usageText(lines)}. A cost center used by budget lines cannot become a group.`,
        });
      }
    }
    if (stored && stored.kind === 'group' && node.kind === 'cost_center') {
      const children = childCount.get(id) ?? 0;
      if (children > 0) {
        issues.push({
          id,
          field: 'kind',
          message: `${node.name} still contains ${plural(children, 'node', 'nodes')}. A group that contains nodes cannot become a cost center.`,
        });
      }
    }

    if (!node.parent_id) continue;
    if (node.parent_id === id) {
      issues.push({ id, field: 'parent_id', message: 'A node cannot be its own parent.' });
      continue;
    }
    const parent = after.get(node.parent_id);
    if (!parent) {
      issues.push({ id, field: 'parent_id', message: 'Parent group not found.' });
      continue;
    }
    if (parent.kind !== 'group') {
      issues.push({ id, field: 'parent_id', message: `Only a group can be a parent. ${parent.code} is a cost center.` });
      continue;
    }
    // Walk up from the new parent; the bound stops on a loop that does not pass through this node.
    let current: string | null = parent.id;
    for (let hop = 0; current && hop <= after.size; hop += 1) {
      if (current === id) {
        issues.push({ id, field: 'parent_id', message: `${node.name} cannot move under ${parent.name}, which is inside it.` });
        break;
      }
      current = after.get(current)?.parent_id ?? null;
    }
  }
  return issues;
}

// -------------------------------------------------------------- field rules ----

export const COST_CENTER_CODE_MAX = 50;
export const COST_CENTER_NAME_MAX = 200;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;
const INT_MIN = -2147483648;
const INT_MAX = 2147483647;

export function costCenterRefusal(message: string, field?: CostCenterField | 'status'): BadRequestException {
  return new BadRequestException({ statusCode: 400, error: 'Bad Request', message, ...(field ? { field } : {}) });
}

export function normalizeCostCenterCode(raw: unknown): string {
  const code = typeof raw === 'string' ? raw.trim() : '';
  if (!code) throw costCenterRefusal('Code is required.', 'code');
  if ([...code].length > COST_CENTER_CODE_MAX) {
    throw costCenterRefusal(`Code must be ${COST_CENTER_CODE_MAX} characters or fewer.`, 'code');
  }
  if (CONTROL_OR_FORMAT.test(code)) throw costCenterRefusal('Code cannot contain control or invisible characters.', 'code');
  return code;
}

export function normalizeCostCenterName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) throw costCenterRefusal('Name is required.', 'name');
  if ([...name].length > COST_CENTER_NAME_MAX) {
    throw costCenterRefusal(`Name must be ${COST_CENTER_NAME_MAX} characters or fewer.`, 'name');
  }
  return name;
}

export function normalizeCostCenterKind(raw: unknown): CostCenterKind {
  const kind = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!(COST_CENTER_KINDS as readonly string[]).includes(kind)) {
    throw costCenterRefusal("Type must be 'group' or 'cost_center'.", 'kind');
  }
  return kind as CostCenterKind;
}

function normalizeDescription(raw: unknown): string | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  return text === '' ? null : text;
}

function normalizeSortOrder(raw: unknown): number {
  if (raw == null || raw === '') return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < INT_MIN || value > INT_MAX) {
    throw costCenterRefusal('Sort order must be a whole number.', 'sort_order');
  }
  return value;
}

function normalizeOptionalId(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  return String(raw);
}

function toGraphNode(row: Pick<StoredCostCenter, 'id' | 'code' | 'name' | 'kind' | 'parent_id' | 'company_id'>): CostCenterGraphNode {
  return { id: row.id, code: row.code, name: row.name, kind: row.kind, parent_id: row.parent_id, company_id: row.company_id };
}

const sameInstant = (a: Date | null, b: Date | null) => (a ? a.getTime() : null) === (b ? b.getTime() : null);

export function costCenterValuesEqual(stored: StoredCostCenter, next: CostCenterValues): boolean {
  return stored.code === next.code
    && stored.kind === next.kind
    && stored.name === next.name
    && (stored.description ?? null) === next.description
    && (stored.parent_id ?? null) === next.parent_id
    && (stored.company_id ?? null) === next.company_id
    && (stored.owner_user_id ?? null) === next.owner_user_id
    && stored.status === next.status
    && sameInstant(stored.disabled_at, next.disabled_at)
    && Number(stored.sort_order) === next.sort_order;
}

// ------------------------------------------------------------ list helpers ----

const FILTER_FIELDS = new Set([
  'code', 'name', 'kind', 'status', 'company_name', 'parent_name', 'parent_code', 'owner_name', 'path', 'disabled_at',
]);
const SORT_FIELDS = new Set([
  'path', 'code', 'name', 'kind', 'status', 'company_name', 'parent_name', 'parent_code', 'owner_name', 'depth', 'sort_order', 'disabled_at',
]);
const MAX_IDS = 10_000;

/** A grid filter model on one value: set, blank, text operators, combined AND/OR. */
function passesFilter(value: unknown, raw: any): boolean {
  if (!raw || typeof raw !== 'object') return true;
  if ((raw.operator === 'AND' || raw.operator === 'OR') && Array.isArray(raw.conditions) && raw.conditions.length > 0) {
    const results = raw.conditions.map((condition: any) => passesFilter(value, condition));
    return raw.operator === 'OR' ? results.some(Boolean) : results.every(Boolean);
  }
  const text = value == null ? '' : String(value);
  const blank = text === '';
  if (raw.filterType === 'set' || raw.type === 'set') {
    const values: unknown[] = Array.isArray(raw.values) ? raw.values : [];
    if (values.length === 0) return false;
    const wanted = values.filter((entry) => entry != null && entry !== '').map((entry) => String(entry));
    if (blank) return wanted.length < values.length;
    return wanted.includes(text);
  }
  const type = String(raw.type ?? 'contains');
  if (type === 'blank') return blank;
  if (type === 'notBlank') return !blank;
  const needleRaw = raw.filter ?? raw.value;
  if (needleRaw == null || needleRaw === '') return true;
  const needle = String(needleRaw).toLowerCase();
  const haystack = text.toLowerCase();
  switch (type) {
    case 'equals': return haystack === needle;
    case 'notEqual': return haystack !== needle;
    case 'startsWith': return haystack.startsWith(needle);
    case 'endsWith': return haystack.endsWith(needle);
    case 'notContains': return !haystack.includes(needle);
    default: return haystack.includes(needle);
  }
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
}

// ----------------------------------------------------------------- service ----

@Injectable()
export class CostCentersService {
  constructor(private readonly audit: AuditService) {}

  // Reads ------------------------------------------------------------------

  async tree(ctx: CostCenterContext): Promise<{ items: CostCenterTreeNode[] }> {
    return { items: await loadCostCenterTree(ctx.manager, ctx.tenantId) };
  }

  /** How many nodes the tenant has: whether a report offers the cost center filter, without the tree. */
  async count(ctx: CostCenterContext): Promise<{ count: number }> {
    const [row] = await ctx.manager.query(
      `SELECT count(*)::int AS count FROM cost_centers WHERE tenant_id = $1`,
      [ctx.tenantId],
    );
    return { count: Number(row?.count ?? 0) };
  }

  async list(query: any, ctx: CostCenterContext) {
    const parsed = parsePagination(query, { field: 'path', direction: 'ASC' });
    const rows = await this.listRows(query, parsed, ctx);
    return { items: rows.slice(parsed.skip, parsed.skip + parsed.limit), total: rows.length, page: parsed.page, limit: parsed.limit };
  }

  async listIds(query: any, ctx: CostCenterContext): Promise<{ ids: string[]; total: number }> {
    const parsed = parsePagination({ ...query, page: 1 }, { field: 'path', direction: 'ASC' });
    const rows = await this.listRows(query, parsed, ctx);
    return { ids: rows.slice(0, MAX_IDS).map((row) => row.id), total: rows.length };
  }

  async get(id: string, ctx: CostCenterContext): Promise<CostCenterDetail> {
    const nodes = await loadCostCenterTree(ctx.manager, ctx.tenantId);
    const node = nodes.find((entry) => entry.id === id);
    if (!node) throw new NotFoundException('Cost center not found.');
    const parent = node.parent_id ? nodes.find((entry) => entry.id === node.parent_id) : undefined;
    const [row] = await ctx.manager.query(
      `SELECT cc.description,
              (SELECT count(*)::int FROM spend_items si WHERE si.tenant_id = $1 AND si.cost_center_id = cc.id) AS opex_count,
              (SELECT count(*)::int FROM capex_items ci WHERE ci.tenant_id = $1 AND ci.cost_center_id = cc.id) AS capex_count
         FROM cost_centers cc
        WHERE cc.tenant_id = $1 AND cc.id = $2`,
      [ctx.tenantId, id],
    );
    return {
      ...node,
      parent_code: parent?.code ?? null,
      parent_name: parent?.name ?? null,
      description: row?.description ?? null,
      opex_count: Number(row?.opex_count ?? 0),
      capex_count: Number(row?.capex_count ?? 0),
    };
  }

  private async listRows(query: any, parsed: ReturnType<typeof parsePagination>, ctx: CostCenterContext): Promise<CostCenterListRow[]> {
    assertSetFilterModes(parsed.filters);
    const nodes = await loadCostCenterTree(ctx.manager, ctx.tenantId);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const treeOrder = new Map(nodes.map((node, index) => [node.id, index]));
    let rows: CostCenterListRow[] = nodes.map((node) => {
      const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
      return { ...node, parent_code: parent?.code ?? null, parent_name: parent?.name ?? null };
    });

    const filters: Record<string, any> = parsed.filters && typeof parsed.filters === 'object' ? parsed.filters : {};
    const includeDisabled = ['1', 'true'].includes(String(query?.includeDisabled ?? '').toLowerCase());
    // Same scope as the other lifecycle lists: enabled only unless asked otherwise.
    if (parsed.status) rows = rows.filter((row) => row.status === parsed.status);
    else if (!includeDisabled && !Object.prototype.hasOwnProperty.call(filters, 'status')) {
      rows = rows.filter((row) => row.status === StatusState.ENABLED);
    }
    for (const [field, model] of Object.entries(filters)) {
      if (!FILTER_FIELDS.has(field)) continue;
      rows = rows.filter((row) => passesFilter((row as any)[field], model));
    }
    const q = String(parsed.q ?? '').trim().toLowerCase();
    if (q) {
      rows = rows.filter((row) => [row.code, row.name, row.path].some((value) => value.toLowerCase().includes(q)));
    }

    const field = SORT_FIELDS.has(parsed.sort.field) ? parsed.sort.field : 'path';
    const dir = parsed.sort.direction === 'DESC' ? -1 : 1;
    const byTree = (a: CostCenterListRow, b: CostCenterListRow) => (treeOrder.get(a.id) ?? 0) - (treeOrder.get(b.id) ?? 0);
    rows.sort((a, b) => {
      if (field === 'path') return byTree(a, b) * dir;
      const av = (a as any)[field];
      const bv = (b as any)[field];
      const aBlank = av == null || av === '';
      const bBlank = bv == null || bv === '';
      if (aBlank || bBlank) {
        if (aBlank && bBlank) return byTree(a, b);
        return aBlank ? dir : -dir;
      }
      return compareValues(av, bv) * dir || byTree(a, b);
    });
    return rows;
  }

  // Writes -----------------------------------------------------------------

  async create(body: CostCenterInput, ctx: CostCenterContext): Promise<CostCenterDetail> {
    const code = normalizeCostCenterCode(body?.code);
    const name = normalizeCostCenterName(body?.name);
    const kind = normalizeCostCenterKind(body?.kind);
    const sortOrder = normalizeSortOrder(body?.sort_order);
    const lifecycle = this.lifecycle(null, body);

    await this.lockTree(ctx);
    const companyId = await this.resolveCompany(ctx, normalizeOptionalId(body?.company_id), null);
    const ownerId = await this.resolveOwner(ctx, normalizeOptionalId(body?.owner_user_id), null);
    const values: CostCenterValues = {
      code,
      kind,
      name,
      description: normalizeDescription(body?.description),
      parent_id: normalizeOptionalId(body?.parent_id),
      company_id: companyId,
      owner_user_id: ownerId,
      status: lifecycle.status,
      disabled_at: lifecycle.disabled_at,
      sort_order: sortOrder,
    };

    const id = randomUUID();
    const before = await this.loadGraph(ctx);
    const after = new Map(before);
    after.set(id, toGraphNode({ id, ...values }));
    this.assertGraph(validateCostCenterGraph({ before, after }));

    await this.persist(ctx, null, values, id);
    return this.get(id, ctx);
  }

  async update(id: string, body: CostCenterInput, ctx: CostCenterContext): Promise<CostCenterDetail> {
    // PATCH semantics: an absent key keeps the stored value, null clears it.
    const has = (key: keyof CostCenterInput) => body != null && Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;

    await this.lockTree(ctx);
    const [existing] = await this.lockNodes(ctx, [id]);
    if (!existing) throw new NotFoundException('Cost center not found.');

    const kind = has('kind') ? normalizeCostCenterKind(body.kind) : existing.kind;
    let companyId = existing.company_id;
    if (has('company_id')) companyId = normalizeOptionalId(body.company_id);
    else if (kind === 'group') companyId = null; // turning into a group drops the company
    const lifecycle = this.lifecycle(existing, body);
    const values: CostCenterValues = {
      code: has('code') ? normalizeCostCenterCode(body.code) : existing.code,
      kind,
      name: has('name') ? normalizeCostCenterName(body.name) : existing.name,
      description: has('description') ? normalizeDescription(body.description) : existing.description ?? null,
      parent_id: has('parent_id') ? normalizeOptionalId(body.parent_id) : existing.parent_id ?? null,
      company_id: await this.resolveCompany(ctx, companyId, existing.company_id),
      owner_user_id: has('owner_user_id')
        ? await this.resolveOwner(ctx, normalizeOptionalId(body.owner_user_id), existing.owner_user_id)
        : existing.owner_user_id ?? null,
      status: lifecycle.status,
      disabled_at: lifecycle.disabled_at,
      sort_order: has('sort_order') ? normalizeSortOrder(body.sort_order) : Number(existing.sort_order),
    };

    const before = await this.loadGraph(ctx);
    const after = new Map(before);
    after.set(id, toGraphNode({ id, ...values }));
    // The node row is locked (FOR UPDATE) above, so a line cannot be attached between this count and the write.
    const usage = existing.kind === 'cost_center' && values.kind === 'group'
      ? await this.countUsage(ctx, [id])
      : undefined;
    this.assertGraph(validateCostCenterGraph({ before, after, usage }));

    if (!costCenterValuesEqual(existing, values)) {
      await this.persist(ctx, existing, values, id);
    }
    return this.get(id, ctx);
  }

  // Shared with the delete and CSV services ----------------------------------

  /** Serializes every write of a tenant's tree (create, update, delete, import). */
  async lockTree(ctx: CostCenterContext): Promise<void> {
    this.assertContext(ctx);
    await ctx.manager.query(`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`, [`cost-center:${ctx.tenantId}`]);
  }

  /** Locks the rows (FOR UPDATE, stable order) and returns them; unknown ids are absent. */
  async lockNodes(ctx: CostCenterContext, ids: string[]): Promise<StoredCostCenter[]> {
    if (ids.length === 0) return [];
    return ctx.manager.query(
      `SELECT * FROM cost_centers WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
      [ctx.tenantId, ids],
    );
  }

  async loadStored(ctx: CostCenterContext): Promise<StoredCostCenter[]> {
    return ctx.manager.query(`SELECT * FROM cost_centers WHERE tenant_id = $1`, [ctx.tenantId]);
  }

  async loadGraph(ctx: CostCenterContext): Promise<Map<string, CostCenterGraphNode>> {
    const rows: StoredCostCenter[] = await ctx.manager.query(
      `SELECT id, code, name, kind, parent_id, company_id FROM cost_centers WHERE tenant_id = $1`,
      [ctx.tenantId],
    );
    return new Map(rows.map((row) => [row.id, toGraphNode(row)]));
  }

  /** OPEX and CAPEX line counts per node, one query. Lock the nodes first when the count guards a write. */
  async countUsage(ctx: CostCenterContext, ids: string[]): Promise<Map<string, CostCenterUsage>> {
    const usage = new Map<string, CostCenterUsage>();
    if (ids.length === 0) return usage;
    const rows: Array<{ id: string; opex: number; capex: number }> = await ctx.manager.query(
      `SELECT cc.id,
              (SELECT count(*)::int FROM spend_items si WHERE si.tenant_id = $1 AND si.cost_center_id = cc.id) AS opex,
              (SELECT count(*)::int FROM capex_items ci WHERE ci.tenant_id = $1 AND ci.cost_center_id = cc.id) AS capex
         FROM cost_centers cc
        WHERE cc.tenant_id = $1 AND cc.id = ANY($2::uuid[])`,
      [ctx.tenantId, ids],
    );
    for (const row of rows) usage.set(row.id, { opex: Number(row.opex), capex: Number(row.capex) });
    return usage;
  }

  /**
   * A company of this tenant; a new assignment must be enabled, the stored one
   * is always kept.
   */
  async resolveCompany(ctx: CostCenterContext, companyId: string | null, currentId: string | null): Promise<string | null> {
    if (!companyId) return null;
    if (companyId === currentId) return companyId;
    const [company] = await ctx.manager.query(
      `SELECT id, disabled_at FROM companies WHERE tenant_id = $1 AND id = $2::uuid`,
      [ctx.tenantId, companyId],
    );
    if (!company) throw costCenterRefusal('Company not found.', 'company_id');
    if (!isActiveAt(company.disabled_at)) throw costCenterRefusal('This company is disabled.', 'company_id');
    return company.id;
  }

  /** An enabled user of this tenant for a new assignment; the stored owner is always kept. */
  async resolveOwner(ctx: CostCenterContext, userId: string | null, currentId: string | null): Promise<string | null> {
    if (!userId) return null;
    if (userId === currentId) return userId;
    const [user] = await ctx.manager.query(
      `SELECT id, status FROM users WHERE tenant_id = $1 AND id = $2::uuid`,
      [ctx.tenantId, userId],
    );
    if (!user) throw costCenterRefusal('Owner not found.', 'owner_user_id');
    if (user.status !== 'enabled') throw costCenterRefusal('The owner must be an active user.', 'owner_user_id');
    return user.id;
  }

  /** Inserts (existing = null) or updates one node and writes its audit row. */
  async persist(
    ctx: CostCenterContext,
    existing: StoredCostCenter | null,
    values: CostCenterValues,
    id: string,
  ): Promise<StoredCostCenter> {
    const params = [
      ctx.tenantId, id, values.code, values.kind, values.name, values.description, values.parent_id,
      values.company_id, values.owner_user_id, values.status, values.disabled_at, values.sort_order,
    ];
    let saved: StoredCostCenter;
    try {
      const rows: StoredCostCenter[] = existing
        ? await ctx.manager.query(
          `UPDATE cost_centers
              SET code = $3, kind = $4, name = $5, description = $6, parent_id = $7, company_id = $8,
                  owner_user_id = $9, status = $10, disabled_at = $11, sort_order = $12, updated_at = now()
            WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
          params,
        )
        : await ctx.manager.query(
          `INSERT INTO cost_centers
             (tenant_id, id, code, kind, name, description, parent_id, company_id, owner_user_id, status, disabled_at, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *`,
          params,
        );
      // An UPDATE … RETURNING through the query runner comes back as [rows, count].
      saved = (Array.isArray(rows[0]) ? (rows[0] as any)[0] : rows[0]) as StoredCostCenter;
    } catch (err: any) {
      if (err?.code === '23505') {
        throw costCenterRefusal(`A cost center with code ${values.code} already exists.`, 'code');
      }
      throw err;
    }
    if (!saved) throw new NotFoundException('Cost center not found.');
    await this.audit.log(
      {
        table: 'cost_centers',
        recordId: id,
        action: existing ? 'update' : 'create',
        before: existing,
        after: saved,
        userId: ctx.userId ?? null,
        source: ctx.audit?.source,
        sourceRef: ctx.audit?.sourceRef ?? null,
      },
      { manager: ctx.manager },
    );
    return saved;
  }

  // Internals ----------------------------------------------------------------

  private lifecycle(existing: StoredCostCenter | null, body: CostCenterInput | undefined) {
    let nextDisabledAt: Date | null | undefined;
    if (body && Object.prototype.hasOwnProperty.call(body, 'disabled_at') && body.disabled_at !== undefined) {
      try {
        nextDisabledAt = parseEndOfValidityInput(body.disabled_at);
      } catch (err) {
        throw costCenterRefusal((err as Error).message, 'disabled_at');
      }
    }
    let nextStatus: StatusState | undefined;
    if (body?.status !== undefined && body?.status !== null) {
      const status = String(body.status).trim().toLowerCase();
      if (status !== StatusState.ENABLED && status !== StatusState.DISABLED) {
        throw costCenterRefusal("Status must be 'enabled' or 'disabled'.", 'status');
      }
      nextStatus = status as StatusState;
    }
    return resolveLifecycleState({
      currentDisabledAt: existing?.disabled_at ?? null,
      nextStatus,
      nextDisabledAt,
    });
  }

  private assertGraph(issues: CostCenterGraphIssue[]) {
    if (issues.length === 0) return;
    const [first] = issues;
    throw costCenterRefusal(first.message, first.field === 'delete' ? undefined : first.field);
  }

  private assertContext(ctx: CostCenterContext) {
    if (!ctx?.manager || !ctx?.tenantId) {
      throw new InternalServerErrorException('Cost center writes need the request transaction.');
    }
  }
}
