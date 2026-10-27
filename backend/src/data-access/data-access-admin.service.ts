import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { cellOf, CsvLanguage, ImportReportError, readMasterDataFile, rowError } from '../common/csv-sheet';
import { uploadedBytes } from '../common/upload';
import { naturesAnd } from '../spend/budget-nature';
import { applyDataAccess, DataAccessMode } from './data-access';
import { dataAccessAvailability, DataAccessAvailability, DataAccessMissing } from './data-access-availability';
import { AccessNodeRow, AccessTree, loadAccessTree, nodeCoversCenter, nodeCoversCompany, widestAccess } from './data-access-tree';
import { lineEditableSql } from './line-write-checks';
import { ListExportFile, writeListExport } from '../common/csv/list-export';
import type { ExportFileFormat } from '../common/xlsx/format';

/**
 * Data-scoped access, lot 6 (planning/data-scoped-access/spec.md §7.1-§7.6, §8): the
 * administration of a person's access. Every route that uses this service is reserved to unscoped
 * persons who administer users: the tenant interceptor refuses a limited person before the handler
 * (`@ReservedToUnscopedDataAccess`), and the permission guard refuses a caller without `users` at
 * admin level.
 *
 * `users.data_access_mode`, `users.data_access_updated_at` and `users.data_access_updated_by` have
 * no entity mapping: they are read and written in SQL, like the nodes.
 */

export type AdminNodeView =
  | { type: 'all'; id: null; name: null; access: 'read' | 'edit' }
  | { type: 'company'; id: string; name: string | null; access: 'read' | 'edit' }
  | {
    type: 'cost_center';
    id: string;
    code: string | null;
    name: string | null;
    kind: 'group' | 'cost_center' | null;
    access: 'read' | 'edit';
  };

export type PersonAccessView = {
  mode: DataAccessMode;
  nodes: AdminNodeView[];
  updated_at: Date | string | null;
  updated_by_name: string | null;
  is_administrator: boolean;
  available: boolean;
  budget_owner_centers: Array<{ id: string; code: string; name: string }>;
};

export type AccessPreview = { lines: number; editable_lines: number; contracts: number };

export type OverviewPerson = {
  id: string;
  name: string;
  roles: string[];
  nodes: AdminNodeView[];
  updated_at: Date | string | null;
  updated_by_name: string | null;
};

export type DataAccessOverview = {
  available: boolean;
  missing: DataAccessMissing[];
  persons: OverviewPerson[];
  counts: { limited_persons: number; lines_without_company: number };
};

export type PersonBrief = { id: string; name: string };

export type NodeVia =
  | { type: 'all'; name: null }
  | { type: 'company'; name: string | null }
  | { type: 'cost_center'; id: string; code: string | null; name: string | null };

export type CompanyAccessView = {
  full: Array<{ person: PersonBrief; via: Extract<NodeVia, { type: 'all' | 'company' }>; access: 'read' | 'edit' }>;
  partial: Array<{ person: PersonBrief; via: Extract<NodeVia, { type: 'cost_center' }>; access: 'read' | 'edit' }>;
};

export type CostCenterAccessView = {
  direct: Array<{ person: PersonBrief; access: 'read' | 'edit' }>;
  inherited: Array<{ person: PersonBrief; via: NodeVia; access: 'read' | 'edit' }>;
};

export type DataAccessImportResult = {
  ok: boolean;
  dryRun: boolean;
  total: number;
  inserted: number;
  updated: number;
  unchanged: number;
  errors: ImportReportError[];
  ignoredColumns: string[];
  notices: { dates: string | null; amounts: string | null };
};

/** The columns of the access file (spec §7.5): one line per person and node. */
export const DATA_ACCESS_CSV_HEADERS = ['email', 'type', 'node', 'access'] as const;

const NODE_TYPES = new Set(['all', 'company', 'cost_center']);
const ACCESS_LEVELS = new Set(['read', 'edit']);

type DetailedNode = AccessNodeRow & {
  company_name: string | null;
  cost_center_code: string | null;
  cost_center_name: string | null;
  cost_center_kind: string | null;
};

type Proposal = { mode: DataAccessMode; nodes: DetailedNode[] };

type LimitedPersonRow = {
  id: string;
  name: string;
  email: string;
  updated_at: Date | string | null;
  updated_by_name: string | null;
};

type TargetUser = {
  id: string;
  mode: DataAccessMode;
  updated_at: Date | string | null;
  updated_by_name: string | null;
  is_administrator: boolean;
};

function conflict(code: string, message: string, extra?: Record<string, unknown>): ConflictException {
  return new ConflictException({ statusCode: 409, error: 'Conflict', code, message, ...(extra ?? {}) });
}

function badRequest(code: string, message: string, extra?: Record<string, unknown>): BadRequestException {
  return new BadRequestException({ statusCode: 400, error: 'Bad Request', code, message, ...(extra ?? {}) });
}

function personName(first: string | null, last: string | null, email: string | null): string {
  const name = [first ?? '', last ?? ''].map((part) => part.trim()).filter(Boolean).join(' ');
  return name || String(email ?? '');
}

/** Every role of these persons, primary first; a role assigned twice appears once. */
async function rolesByUser(manager: EntityManager, tenantId: string, userIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (userIds.length === 0) return out;
  const rows: Array<{ user_id: string; role_name: string; is_primary: boolean }> = await manager.query(
    `SELECT ur.user_id, r.role_name, ur.is_primary
       FROM user_roles ur
       JOIN roles r ON r.tenant_id = ur.tenant_id AND r.id = ur.role_id
      WHERE ur.tenant_id = $1 AND ur.user_id = ANY($2::uuid[])
      UNION
     SELECT u.id AS user_id, r.role_name, true AS is_primary
       FROM users u
       JOIN roles r ON r.tenant_id = u.tenant_id AND r.id = u.role_id
      WHERE u.tenant_id = $1 AND u.id = ANY($2::uuid[])
      ORDER BY user_id, is_primary DESC, role_name`,
    [tenantId, userIds],
  );
  for (const row of rows) {
    const list = out.get(row.user_id) ?? [];
    if (!list.includes(row.role_name)) list.push(row.role_name);
    out.set(row.user_id, list);
  }
  return out;
}

/** The detail of the person's nodes, names resolved. Stable order: all, companies, centres by code. */
async function readNodes(manager: EntityManager, userId: string): Promise<DetailedNode[]> {
  const rows: DetailedNode[] = await manager.query(
    `SELECT n.id, n.node_type, n.access, n.company_id, n.cost_center_id,
            co.name AS company_name, cc.code AS cost_center_code, cc.name AS cost_center_name,
            cc.kind AS cost_center_kind
       FROM user_data_access_nodes n
       LEFT JOIN companies co ON co.tenant_id = n.tenant_id AND co.id = n.company_id
       LEFT JOIN cost_centers cc ON cc.tenant_id = n.tenant_id AND cc.id = n.cost_center_id
      WHERE n.tenant_id = app_current_tenant() AND n.user_id = $1
      ORDER BY CASE n.node_type WHEN 'all' THEN 0 WHEN 'company' THEN 1 ELSE 2 END,
               lower(co.name), lower(cc.code), n.id`,
    [userId],
  );
  return rows.map((row) => ({
    ...row,
    access: row.access === 'edit' ? 'edit' : 'read',
    node_type: row.node_type === 'company' || row.node_type === 'cost_center' ? row.node_type : 'all',
  }));
}

function viewOf(node: DetailedNode): AdminNodeView {
  if (node.node_type === 'company') {
    return { type: 'company', id: String(node.company_id), name: node.company_name ?? null, access: node.access };
  }
  if (node.node_type === 'cost_center') {
    return {
      type: 'cost_center',
      id: String(node.cost_center_id),
      code: node.cost_center_code ?? null,
      name: node.cost_center_name ?? null,
      kind: node.cost_center_kind === 'group' || node.cost_center_kind === 'cost_center' ? node.cost_center_kind : null,
      access: node.access,
    };
  }
  return { type: 'all', id: null, name: null, access: node.access };
}

/** The stable order of a proposed set: all, companies by name, centres by code. */
function compareDetailedNodes(a: DetailedNode, b: DetailedNode): number {
  const rank = (node: DetailedNode) => node.node_type === 'all' ? 0 : node.node_type === 'company' ? 1 : 2;
  const type = rank(a) - rank(b);
  if (type !== 0) return type;
  const an = (a.node_type === 'company' ? a.company_name : a.cost_center_code) ?? '';
  const bn = (b.node_type === 'company' ? b.company_name : b.cost_center_code) ?? '';
  const byName = an.toLowerCase().localeCompare(bn.toLowerCase());
  if (byName !== 0) return byName;
  return String(a.company_id ?? a.cost_center_id ?? '').localeCompare(String(b.company_id ?? b.cost_center_id ?? ''));
}

/** The readable before/after of the audit log (spec §7.6): names or codes, stable order. */
function snapshotOf(mode: DataAccessMode, nodes: readonly DetailedNode[]) {
  return {
    mode,
    nodes: [...nodes].sort(compareDetailedNodes).map((node) => {
      if (node.node_type === 'company') {
        return { type: 'company', name: node.company_name ?? null, access: node.access };
      }
      if (node.node_type === 'cost_center') {
        return {
          type: 'cost_center',
          code: node.cost_center_code ?? null,
          name: node.cost_center_name ?? null,
          access: node.access,
        };
      }
      return { type: 'all', name: null, access: node.access };
    }),
  };
}

/**
 * A node set as the canonical keys `type:id:access`, ids lower case, sorted. PostgreSQL and
 * JavaScript order names and codes differently (the database's collation, `localeCompare`), so
 * the two sides of a comparison are reduced to this set instead of comparing ordered rows
 * (spec §7.6: a save with no effect writes and audits nothing, whatever the collation).
 */
function canonicalNodeKeys(nodes: readonly DetailedNode[]): string[] {
  return nodes
    .map((node) => `${node.node_type}:${String(node.company_id ?? node.cost_center_id ?? '').toLowerCase()}:${node.access}`)
    .sort();
}

/** Whether the stored access and the proposed one are the same set, in whatever order they were read. */
function sameSnapshot(
  beforeMode: DataAccessMode,
  beforeNodes: readonly DetailedNode[],
  afterMode: DataAccessMode,
  afterNodes: readonly DetailedNode[],
): boolean {
  return beforeMode === afterMode
    && canonicalNodeKeys(beforeNodes).join('\n') === canonicalNodeKeys(afterNodes).join('\n');
}

/**
 * The administration service of data-scoped access. `availability` is injectable so a spec can
 * simulate a missing role; production uses the cached check of the data source.
 */
export const DATA_ACCESS_AVAILABILITY = 'DATA_ACCESS_AVAILABILITY';

@Injectable()
export class DataAccessAdminService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    @Optional() @Inject(DATA_ACCESS_AVAILABILITY) private readonly availabilityOverride?: () => Promise<DataAccessAvailability>,
  ) {}

  private availability(): Promise<DataAccessAvailability> {
    return this.availabilityOverride ? this.availabilityOverride() : dataAccessAvailability(this.dataSource);
  }

  /** `GET /users/:id/data-access` (spec §8). */
  async personAccess(manager: EntityManager, targetId: string): Promise<PersonAccessView> {
    const availability = await this.availability();
    const target = await this.readTarget(manager, targetId);
    const nodes = !target.is_administrator && target.mode === 'limited'
      ? await readNodes(manager, targetId)
      : [];
    const owners: Array<{ id: string; code: string; name: string }> = await manager.query(
      `SELECT id, code, name
         FROM cost_centers
        WHERE tenant_id = app_current_tenant()
          AND owner_user_id = $1
          AND kind = 'cost_center'
        ORDER BY lower(code), id`,
      [targetId],
    );
    return {
      mode: target.is_administrator ? 'all' : target.mode,
      nodes: nodes.map(viewOf),
      updated_at: target.updated_at,
      updated_by_name: target.updated_by_name,
      is_administrator: target.is_administrator,
      available: availability.available,
      budget_owner_centers: owners.map((row) => ({ id: row.id, code: row.code, name: row.name })),
    };
  }

  /**
   * `PUT /users/:id/data-access` (spec §8): replaces the mode and the whole node set, then audits
   * one `user_data_access` entry. A save with no effect writes nothing and audits nothing.
   */
  async updatePerson(
    manager: EntityManager,
    targetId: string,
    body: unknown,
    callerId: string | null,
    source: 'screen' | 'import' = 'screen',
  ): Promise<PersonAccessView> {
    const availability = await this.availability();
    await this.lockAccess(manager);
    const target = await this.readTarget(manager, targetId, { forUpdate: true });
    const proposal = await this.parseProposal(manager, body);
    this.assertTarget(callerId, target, proposal.mode);
    if (proposal.mode === 'limited' && !availability.available) {
      throw conflict('DATA_ACCESS_UNAVAILABLE', 'Data-scoped access is unavailable.', { missing: availability.missing });
    }
    await this.writeProposal(manager, targetId, proposal, callerId, source);
    return this.personAccess(manager, targetId);
  }

  /**
   * `POST /users/:id/data-access/preview` (spec §8, "L'aperçu suit le chemin réel"): the counts the
   * proposed access would show, without keeping anything.
   *
   * A proposed `all` reads the unscoped counts directly (the caller is unscoped; there is nothing
   * to restrict). A proposed `limited` writes the mode and nodes under a savepoint, applies the
   * target's access with `data_access_apply`, counts under the policies, rolls back to the
   * savepoint, then applies the caller again: the savepoint restores the role and the settings, and
   * the second call resets the in-memory mode of the transaction even when the settings are already
   * back. The restore is verified before the response leaves; a transaction that would go on with
   * the target's access fails instead of answering.
   */
  async preview(manager: EntityManager, targetId: string, body: unknown, callerId: string): Promise<AccessPreview> {
    const availability = await this.availability();
    const target = await this.readTarget(manager, targetId);
    const proposal = await this.parseProposal(manager, body);
    this.assertTarget(callerId, target, proposal.mode);
    if (proposal.mode === 'limited' && !availability.available) {
      throw conflict('DATA_ACCESS_UNAVAILABLE', 'Data-scoped access is unavailable.', { missing: availability.missing });
    }
    if (proposal.mode === 'all') return this.countUnscoped(manager);

    await manager.query('SAVEPOINT data_access_preview');
    let counted: AccessPreview;
    try {
      await this.writeProposal(manager, targetId, proposal, callerId, 'screen', { audit: false });
      await applyDataAccess(manager, targetId);
      counted = await this.countUnderPolicies(manager);
    } finally {
      await manager.query('ROLLBACK TO SAVEPOINT data_access_preview; RELEASE SAVEPOINT data_access_preview');
      // The savepoint puts the role and the settings back; this call also resets the mode kept in
      // memory for the runner (`appliedModes`), which would otherwise say `limited` for the rest of
      // the request (spec §8).
      await applyDataAccess(manager, callerId);
      await this.assertUnscopedRestored(manager);
    }
    return counted;
  }

  /** `GET /data-access` (spec §7.3, §8). */
  async overview(
    manager: EntityManager,
    query: { node_type?: unknown; node_id?: unknown; q?: unknown },
  ): Promise<DataAccessOverview> {
    const availability = await this.availability();
    const tenantId: string = (await manager.query(`SELECT app_current_tenant()::text AS tenant_id`))[0].tenant_id;
    // A repeated parameter arrives as an array and used to be ignored: answer a clear 400 instead.
    for (const parameter of ['node_type', 'node_id', 'q'] as const) {
      if (Array.isArray(query?.[parameter])) {
        throw badRequest('DATA_ACCESS_QUERY_REPEATED', `${parameter} must be given once.`, { parameter });
      }
    }
    const nodeType = typeof query?.node_type === 'string' && query.node_type.trim() ? query.node_type.trim() : null;
    const nodeId = typeof query?.node_id === 'string' && query.node_id.trim() ? query.node_id.trim() : null;
    if (nodeType && !NODE_TYPES.has(nodeType)) {
      throw badRequest('DATA_ACCESS_NODE_TYPE_INVALID', 'Node type must be "all", "company" or "cost_center".');
    }
    if (nodeId && !isUUID(nodeId)) {
      throw badRequest('DATA_ACCESS_NODE_ID_INVALID', 'The node id must be a UUID.');
    }
    if (nodeType === 'all' && nodeId) {
      throw badRequest('DATA_ACCESS_NODE_ID_FORBIDDEN', 'The "all" node has no id.');
    }
    const q = typeof query?.q === 'string' ? query.q.trim() : '';

    const notAdministrator = `NOT EXISTS (
      SELECT 1
      FROM (
        SELECT u.role_id
        UNION
        SELECT ur.role_id FROM user_roles ur WHERE ur.user_id = u.id AND ur.tenant_id = u.tenant_id
      ) assigned
      JOIN roles r ON r.id = assigned.role_id AND r.tenant_id = u.tenant_id
      WHERE lower(trim(r.role_name)) = 'administrator'
    )`;
    const params: unknown[] = [tenantId];
    const filters: string[] = [`u.tenant_id = $1`, `u.data_access_mode = 'limited'`, notAdministrator];
    if (q) {
      params.push(q.toLowerCase());
      filters.push(
        `position($${params.length} in lower(
           coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '') || ' ' || u.email
         )) > 0`,
      );
    }
    if (nodeType || nodeId) {
      const nodeFilters: string[] = ['n.tenant_id = u.tenant_id', 'n.user_id = u.id'];
      if (nodeType) {
        params.push(nodeType);
        nodeFilters.push(`n.node_type = $${params.length}`);
      }
      if (nodeId) {
        params.push(nodeId);
        nodeFilters.push(`(n.company_id = $${params.length}::uuid OR n.cost_center_id = $${params.length}::uuid)`);
      }
      filters.push(`EXISTS (SELECT 1 FROM user_data_access_nodes n WHERE ${nodeFilters.join(' AND ')})`);
    }

    const persons: LimitedPersonRow[] = await manager.query(
      `SELECT u.id,
              trim(concat_ws(' ', u.first_name, u.last_name)) AS name,
              u.email,
              u.data_access_updated_at AS updated_at,
              nullif(trim(concat_ws(' ', ub.first_name, ub.last_name)), '') AS updated_by_name
         FROM users u
         LEFT JOIN users ub ON ub.tenant_id = u.tenant_id AND ub.id = u.data_access_updated_by
        WHERE ${filters.join(' AND ')}
        ORDER BY lower(coalesce(nullif(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email)), u.id`,
      params,
    );
    const ids = persons.map((person) => person.id);
    const nodesById = new Map<string, DetailedNode[]>();
    if (ids.length > 0) {
      const rows: Array<DetailedNode & { user_id: string }> = await manager.query(
        `SELECT n.user_id, n.id, n.node_type, n.access, n.company_id, n.cost_center_id,
                co.name AS company_name, cc.code AS cost_center_code, cc.name AS cost_center_name,
                cc.kind AS cost_center_kind
           FROM user_data_access_nodes n
           LEFT JOIN companies co ON co.tenant_id = n.tenant_id AND co.id = n.company_id
           LEFT JOIN cost_centers cc ON cc.tenant_id = n.tenant_id AND cc.id = n.cost_center_id
          WHERE n.tenant_id = $1 AND n.user_id = ANY($2::uuid[])
          ORDER BY CASE n.node_type WHEN 'all' THEN 0 WHEN 'company' THEN 1 ELSE 2 END,
                   lower(co.name), lower(cc.code), n.id`,
        [tenantId, ids],
      );
      for (const row of rows) {
        const list = nodesById.get(row.user_id) ?? [];
        list.push({
          ...row,
          access: row.access === 'edit' ? 'edit' : 'read',
          node_type: row.node_type === 'company' || row.node_type === 'cost_center' ? row.node_type : 'all',
        });
        nodesById.set(row.user_id, list);
      }
    }
    const roles = await rolesByUser(manager, tenantId, ids);
    const [counts] = await manager.query(
      `SELECT
         (SELECT count(*)::int
            FROM users u
           WHERE u.tenant_id = $1
             AND u.data_access_mode = 'limited'
             AND ${notAdministrator}) AS limited_persons,
         (SELECT count(*)::int
            FROM spend_items i
           WHERE i.tenant_id = $1
             ${naturesAnd('i', ['opex', 'capex'])}
             AND i.paying_company_id IS NULL) AS lines_without_company`,
      [tenantId],
    );

    return {
      available: availability.available,
      missing: availability.missing,
      persons: persons.map((person) => ({
        id: person.id,
        name: person.name || person.email,
        roles: roles.get(person.id) ?? [],
        nodes: (nodesById.get(person.id) ?? []).map(viewOf),
        updated_at: person.updated_at,
        updated_by_name: person.updated_by_name ?? null,
      })),
      counts: {
        limited_persons: Number(counts?.limited_persons ?? 0),
        lines_without_company: Number(counts?.lines_without_company ?? 0),
      },
    };
  }

  /** `GET /companies/:id/data-access` (spec §7.2): who sees the whole company, and who sees a part of it. */
  async companyAccess(manager: EntityManager, companyId: string): Promise<CompanyAccessView> {
    const tenantId: string = (await manager.query(`SELECT app_current_tenant()::text AS tenant_id`))[0].tenant_id;
    const [company] = await manager.query(
      `SELECT id, name FROM companies WHERE tenant_id = $1 AND id = $2::uuid`,
      [tenantId, companyId],
    );
    if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND', message: 'Company not found.' });
    const tree = await loadAccessTree(manager, tenantId);
    const persons = await this.loadLimitedPersons(manager, tenantId);

    const full: CompanyAccessView['full'] = [];
    const partial: CompanyAccessView['partial'] = [];
    for (const person of persons) {
      const fullNodes = person.nodes.filter((node) => node.node_type === 'all'
        || (node.node_type === 'company' && node.company_id === companyId));
      if (fullNodes.length > 0) {
        const chosen = this.chooseCompanyNode(fullNodes, tree);
        full.push({
          person: { id: person.id, name: person.name },
          via: chosen.node_type === 'all'
            ? { type: 'all', name: null }
            : { type: 'company', name: tree.companies.get(chosen.company_id ?? '')?.name ?? null },
          access: widestAccess(fullNodes),
        });
        continue;
      }
      const partialNodes = person.nodes.filter((node) => node.node_type === 'cost_center' && nodeCoversCompany(node, companyId, tree));
      if (partialNodes.length === 0) continue;
      const chosen = this.chooseCompanyNode(partialNodes, tree);
      const center = tree.centers.get(chosen.cost_center_id ?? '');
      if (!center) continue;
      partial.push({
        person: { id: person.id, name: person.name },
        via: { type: 'cost_center', id: center.id, code: center.code, name: center.name },
        access: widestAccess(partialNodes),
      });
    }
    return { full, partial };
  }

  /** `GET /cost-centers/:id/data-access` (spec §7.2): the direct nodes, then what covers the node. */
  async costCenterAccess(manager: EntityManager, centerId: string): Promise<CostCenterAccessView> {
    const tenantId: string = (await manager.query(`SELECT app_current_tenant()::text AS tenant_id`))[0].tenant_id;
    const tree = await loadAccessTree(manager, tenantId);
    const center = tree.centers.get(centerId);
    if (!center) throw new NotFoundException({ code: 'COST_CENTER_NOT_FOUND', message: 'Cost center not found.' });
    const persons = await this.loadLimitedPersons(manager, tenantId);

    const direct: CostCenterAccessView['direct'] = [];
    const inherited: CostCenterAccessView['inherited'] = [];
    for (const person of persons) {
      const directNodes = person.nodes.filter((node) => node.node_type === 'cost_center' && node.cost_center_id === center.id);
      if (directNodes.length > 0) {
        direct.push({ person: { id: person.id, name: person.name }, access: widestAccess(directNodes) });
        continue;
      }
      const candidates: Array<{ node: DetailedNode; via: NodeVia; distance: number }> = [];
      for (const node of person.nodes) {
        const cover = nodeCoversCenter(node, center, tree);
        if (!cover.covered) continue;
        if (node.node_type === 'cost_center') {
          const viaCenter = tree.centers.get(node.cost_center_id ?? '');
          if (!viaCenter) continue;
          candidates.push({
            node,
            via: { type: 'cost_center', id: viaCenter.id, code: viaCenter.code, name: viaCenter.name },
            distance: cover.distance,
          });
        } else if (node.node_type === 'company') {
          candidates.push({
            node,
            via: { type: 'company', name: tree.companies.get(node.company_id ?? '')?.name ?? null },
            distance: cover.distance,
          });
        } else {
          candidates.push({ node, via: { type: 'all', name: null }, distance: cover.distance });
        }
      }
      if (candidates.length === 0) continue;
      candidates.sort((a, b) => {
        const access = Number(b.node.access === 'edit') - Number(a.node.access === 'edit');
        if (access !== 0) return access;
        if (a.distance !== b.distance) return a.distance - b.distance;
        const typeA = a.via.type === 'cost_center' ? 0 : a.via.type === 'company' ? 1 : 2;
        const typeB = b.via.type === 'cost_center' ? 0 : b.via.type === 'company' ? 1 : 2;
        return typeA - typeB;
      });
      const chosen = candidates[0];
      inherited.push({
        person: { id: person.id, name: person.name },
        via: chosen.via,
        access: widestAccess(candidates.map((candidate) => candidate.node)),
      });
    }
    return { direct, inherited };
  }

  /** `GET /data-access/export` (spec §7.5): one line per limited, non-Administrator person and node. */
  async exportCsv<F extends ExportFileFormat = 'csv'>(manager: EntityManager, language: CsvLanguage, format: F = 'csv' as F): Promise<ListExportFile<F>> {
    const tenantId: string = (await manager.query(`SELECT app_current_tenant()::text AS tenant_id`))[0].tenant_id;
    const persons = await this.loadLimitedPersons(manager, tenantId);
    const tree = await loadAccessTree(manager, tenantId);
    const rows: string[][] = [];
    for (const person of persons) {
      for (const node of person.nodes) {
        if (node.node_type === 'company') {
          rows.push([person.email, 'company', tree.companies.get(node.company_id ?? '')?.name ?? '', node.access]);
        } else if (node.node_type === 'cost_center') {
          rows.push([person.email, 'cost_center', tree.centers.get(node.cost_center_id ?? '')?.code ?? '', node.access]);
        } else {
          rows.push([person.email, 'all', '', node.access]);
        }
      }
    }
    return writeListExport({
      format,
      language,
      filename: 'data_access.csv',
      sheetNames: { en: 'Data access', fr: 'Accès aux données', de: 'Datenzugriff', es: 'Acceso a datos' },
      headers: [...DATA_ACCESS_CSV_HEADERS],
      rows,
    });
  }

  /**
   * `POST /data-access/import?dryRun=` (spec §7.5). A person present in the file receives exactly
   * the listed nodes, in mode `limited`; an absent person does not change. Nothing is written when
   * any row is refused. One audit entry per changed person (`source: 'import'`).
   */
  async importCsv(
    manager: EntityManager,
    input: {
      file: Express.Multer.File | undefined;
      dryRun: boolean;
      language: CsvLanguage;
      callerId: string | null;
    },
  ): Promise<DataAccessImportResult> {
    const availability = await this.availability();
    const read = await readMasterDataFile({
      file: uploadedBytes(input.file) as Buffer,
      fields: DATA_ACCESS_CSV_HEADERS,
      language: input.language,
    });
    const result = (
      errors: ImportReportError[],
      total = 0,
      counts: { updated?: number; unchanged?: number } = {},
    ): DataAccessImportResult => ({
      ok: false,
      dryRun: input.dryRun,
      total,
      inserted: 0,
      updated: counts.updated ?? 0,
      unchanged: counts.unchanged ?? 0,
      errors,
      ignoredColumns: read.ignoredColumns,
      notices: read.notices,
    });
    if (read.headerError) return result([read.headerError]);
    const rows = read.rows;
    if (rows.length === 0) {
      return { ok: true, dryRun: input.dryRun, total: 0, inserted: 0, updated: 0, unchanged: 0, errors: [], ignoredColumns: read.ignoredColumns, notices: read.notices };
    }
    if (!availability.available) {
      return result([{
        row: 0,
        message: 'Data-scoped access is unavailable.',
        code: 'DATA_ACCESS_UNAVAILABLE',
        params: { missing: availability.missing.join(', ') },
      }], rows.length);
    }

    const tenantId: string = (await manager.query(`SELECT app_current_tenant()::text AS tenant_id`))[0].tenant_id;
    await this.lockAccess(manager);
    const tree = await loadAccessTree(manager, tenantId);
    const companiesByName = new Map<string, Array<{ id: string; name: string }>>();
    for (const company of tree.companies.values()) {
      const key = company.name.trim().toLowerCase();
      companiesByName.set(key, [...(companiesByName.get(key) ?? []), company]);
    }
    const emails = Array.from(new Set(rows.map((row) => cellOf(row, 'email').toLowerCase()).filter(Boolean)));
    const users: Array<{ id: string; email: string; first_name: string | null; last_name: string | null; is_administrator: boolean }> = emails.length
      ? await manager.query(
        `SELECT u.id, u.email, u.first_name, u.last_name,
                EXISTS (
                  SELECT 1
                  FROM (
                    SELECT u.role_id
                    UNION
                    SELECT ur.role_id FROM user_roles ur WHERE ur.user_id = u.id AND ur.tenant_id = u.tenant_id
                  ) assigned
                  JOIN roles r ON r.id = assigned.role_id AND r.tenant_id = u.tenant_id
                  WHERE lower(trim(r.role_name)) = 'administrator'
                ) AS is_administrator
           FROM users u
          WHERE u.tenant_id = $1 AND lower(u.email) = ANY($2::text[])`,
        [tenantId, emails],
      )
      : [];
    const usersByEmail = new Map(users.map((user) => [user.email.toLowerCase(), user]));

    const errors: ImportReportError[] = [];
    const byPerson = new Map<string, { user: typeof users[number]; rows: Array<{ line: number; node: DetailedNode | null }>; seen: Set<string> }>();
    rows.forEach((raw) => {
      const line = raw.line;
      const email = cellOf(raw, 'email');
      const type = cellOf(raw, 'type');
      const nodeCell = cellOf(raw, 'node');
      const access = cellOf(raw, 'access');
      const personErrors: ImportReportError[] = [];
      const user = email ? usersByEmail.get(email.toLowerCase()) : undefined;
      if (!email) personErrors.push(rowError(line, 'email', 'CSV_VALUE_REQUIRED', 'The email is required.'));
      else if (!user) personErrors.push(rowError(line, 'email', 'CSV_REFERENCE_NOT_FOUND', `Unknown person '${email}'.`, { value: email }));
      else if (input.callerId === user.id) {
        personErrors.push(rowError(line, 'email', 'DATA_ACCESS_SELF', 'You cannot change your own data access.'));
      } else if (user.is_administrator === true) {
        personErrors.push(rowError(line, 'email', 'DATA_ACCESS_ADMINISTRATOR', 'Administrators see all data.'));
      }
      if (!type || !NODE_TYPES.has(type)) {
        personErrors.push(type
          ? rowError(line, 'type', 'CSV_ENUM_INVALID', `Invalid type '${type}'. Use 'all', 'company' or 'cost_center'.`, { value: type, allowed: 'all, company, cost_center' })
          : rowError(line, 'type', 'CSV_VALUE_REQUIRED', 'The type is required.'));
      }
      if (!access || !ACCESS_LEVELS.has(access)) {
        personErrors.push(access
          ? rowError(line, 'access', 'CSV_ENUM_INVALID', `Invalid access '${access}'. Use 'read' or 'edit'.`, { value: access, allowed: 'read, edit' })
          : rowError(line, 'access', 'CSV_VALUE_REQUIRED', 'The access is required.'));
      }
      let node: DetailedNode | null = null;
      if (type === 'all') {
        if (nodeCell) personErrors.push(rowError(line, 'node', 'DATA_ACCESS_NODE_ID_FORBIDDEN', 'The "all" node has no node.'));
        else {
          node = {
            id: '', node_type: 'all', access: access === 'edit' ? 'edit' : 'read',
            company_id: null, cost_center_id: null, company_name: null,
            cost_center_code: null, cost_center_name: null, cost_center_kind: null,
          };
        }
      } else if (type === 'company') {
        if (!nodeCell) personErrors.push(rowError(line, 'node', 'DATA_ACCESS_NODE_ID_REQUIRED', 'A company node needs its company name.'));
        else {
          const matches = companiesByName.get(nodeCell.toLowerCase()) ?? [];
          const company = matches.find((entry) => entry.name.trim() === nodeCell) ?? (matches.length === 1 ? matches[0] : undefined);
          if (!company) {
            personErrors.push(matches.length > 1
              ? rowError(line, 'node', 'CSV_NAME_AMBIGUOUS', `Company name '${nodeCell}' matches several companies.`, { value: nodeCell })
              : rowError(line, 'node', 'CSV_REFERENCE_NOT_FOUND', `Unknown company '${nodeCell}'.`, { value: nodeCell }));
          } else {
            node = {
              id: '', node_type: 'company', access: access === 'edit' ? 'edit' : 'read',
              company_id: company.id, cost_center_id: null, company_name: company.name,
              cost_center_code: null, cost_center_name: null, cost_center_kind: null,
            };
          }
        }
      } else if (type === 'cost_center') {
        if (!nodeCell) personErrors.push(rowError(line, 'node', 'DATA_ACCESS_NODE_ID_REQUIRED', 'A cost center node needs its code.'));
        else {
          const match = [...tree.centers.values()].find((center) => center.code.trim().toLowerCase() === nodeCell.toLowerCase());
          if (!match) personErrors.push(rowError(line, 'node', 'CSV_REFERENCE_NOT_FOUND', `Unknown cost center '${nodeCell}'.`, { value: nodeCell }));
          else {
            node = {
              id: '', node_type: 'cost_center', access: access === 'edit' ? 'edit' : 'read',
              company_id: null, cost_center_id: match.id, company_name: null,
              cost_center_code: match.code, cost_center_name: match.name, cost_center_kind: match.kind,
            };
          }
        }
      }
      if (personErrors.length > 0 || !user || !node) {
        errors.push(...personErrors);
        return;
      }
      const key = user.id.toLowerCase();
      const entry = byPerson.get(key) ?? { user, rows: [], seen: new Set<string>() };
      const nodeKey = `${node.node_type}:${node.company_id ?? node.cost_center_id ?? ''}`;
      if (entry.seen.has(nodeKey)) {
        errors.push(rowError(line, 'node', 'CSV_DUPLICATE_KEY', 'This node is listed twice for this person.', { value: nodeCell }));
        return;
      }
      entry.seen.add(nodeKey);
      entry.rows.push({ line, node });
      byPerson.set(key, entry);
    });
    if (errors.length > 0) {
      const sorted = [...errors].sort((a, b) => a.row - b.row);
      return { ...result(sorted, rows.length), ok: false };
    }

    let updated = 0;
    let unchanged = 0;
    const changed: Array<{ id: string; proposal: Proposal }> = [];
    for (const entry of byPerson.values()) {
      const proposal: Proposal = {
        mode: 'limited',
        nodes: entry.rows.map((row) => row.node!).sort(compareDetailedNodes),
      };
      const before = await this.storedState(manager, entry.user.id);
      const same = sameSnapshot(before.mode, before.nodes, 'limited', proposal.nodes);
      if (same) unchanged += 1;
      else {
        updated += 1;
        changed.push({ id: entry.user.id, proposal });
      }
    }
    if (!input.dryRun) {
      for (const entry of changed) {
        await this.writeProposal(manager, entry.id, entry.proposal, input.callerId, 'import');
      }
    }
    return {
      ok: true,
      dryRun: input.dryRun,
      total: rows.length,
      inserted: 0,
      updated,
      unchanged,
      errors: [],
      ignoredColumns: read.ignoredColumns,
      notices: read.notices,
    };
  }

  // -------------------------------------------------------------------------------------------
  // Helpers.

  private async readTarget(manager: EntityManager, targetId: string, opts: { forUpdate?: boolean } = {}): Promise<TargetUser> {
    const rows: Array<{
      id: string;
      data_access_mode: string;
      data_access_updated_at: Date | string | null;
      updated_by_name: string | null;
      is_administrator: boolean;
    }> = await manager.query(
      `SELECT u.id, u.data_access_mode, u.data_access_updated_at,
              nullif(trim(concat_ws(' ', ub.first_name, ub.last_name)), '') AS updated_by_name,
              EXISTS (
                SELECT 1
                FROM (
                  SELECT u.role_id
                  UNION
                  SELECT ur.role_id FROM user_roles ur WHERE ur.user_id = u.id AND ur.tenant_id = u.tenant_id
                ) assigned
                JOIN roles r ON r.id = assigned.role_id AND r.tenant_id = u.tenant_id
                WHERE lower(trim(r.role_name)) = 'administrator'
              ) AS is_administrator
         FROM users u
         LEFT JOIN users ub ON ub.tenant_id = u.tenant_id AND ub.id = u.data_access_updated_by
        WHERE u.tenant_id = app_current_tenant() AND u.id = $1
        ${opts.forUpdate ? 'FOR UPDATE OF u' : ''}`,
      [targetId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });
    return {
      id: row.id,
      mode: row.data_access_mode === 'limited' ? 'limited' : 'all',
      updated_at: row.data_access_updated_at,
      updated_by_name: row.updated_by_name ?? null,
      is_administrator: row.is_administrator === true,
    };
  }

  private assertTarget(callerId: string | null, target: TargetUser, mode: DataAccessMode): void {
    if (callerId && callerId === target.id) {
      throw conflict('DATA_ACCESS_SELF', 'You cannot change your own data access.');
    }
    // An Administrator stored as limited (the role was removed, or set before the role) sees all
    // data and is listed nowhere: writing `all` puts the stored mode back in line. Limiting one is
    // refused.
    if (target.is_administrator && mode !== 'all') {
      throw conflict('DATA_ACCESS_ADMINISTRATOR', 'Administrators see all data.');
    }
  }

  private async parseProposal(manager: EntityManager, body: unknown): Promise<Proposal> {
    const input = (body ?? {}) as { mode?: unknown; nodes?: unknown };
    const mode = input.mode;
    if (mode !== 'all' && mode !== 'limited') {
      throw badRequest('DATA_ACCESS_MODE_INVALID', 'mode must be "all" or "limited".');
    }
    if (input.nodes !== undefined && !Array.isArray(input.nodes)) {
      throw badRequest('DATA_ACCESS_NODES_INVALID', 'nodes must be an array.');
    }
    const rawNodes: unknown[] = Array.isArray(input.nodes) ? input.nodes : [];
    if (mode === 'all' && rawNodes.length > 0) {
      throw badRequest('DATA_ACCESS_ALL_WITH_NODES', 'The "all" mode takes no nodes.');
    }

    const companyIds = new Set<string>();
    const centerIds = new Set<string>();
    const seen = new Set<string>();
    const inputs: Array<{ type: 'all' | 'company' | 'cost_center'; id: string | null; access: 'read' | 'edit' }> = [];
    rawNodes.forEach((raw, index) => {
      const node = (raw ?? {}) as { type?: unknown; id?: unknown; access?: unknown };
      const type = node.type;
      if (type !== 'all' && type !== 'company' && type !== 'cost_center') {
        throw badRequest('DATA_ACCESS_NODE_TYPE_INVALID', `Node ${index + 1}: type must be "all", "company" or "cost_center".`);
      }
      const access = node.access;
      if (access !== 'read' && access !== 'edit') {
        throw badRequest('DATA_ACCESS_ACCESS_INVALID', `Node ${index + 1}: access must be "read" or "edit".`);
      }
      let id: string | null = null;
      if (type === 'all') {
        if (node.id !== undefined && node.id !== null && String(node.id) !== '') {
          throw badRequest('DATA_ACCESS_NODE_ID_FORBIDDEN', 'The "all" node has no id.');
        }
      } else {
        if (typeof node.id !== 'string' || !node.id || !isUUID(node.id)) {
          throw badRequest('DATA_ACCESS_NODE_ID_REQUIRED', `Node ${index + 1}: ${type === 'company' ? 'a company' : 'a cost center'} node needs a UUID id.`);
        }
        id = node.id.toLowerCase();
        if (type === 'company') companyIds.add(id);
        else centerIds.add(id);
      }
      const key = `${type}:${id ?? ''}`;
      if (seen.has(key)) throw badRequest('DATA_ACCESS_NODE_DUPLICATE', `Node ${index + 1} appears twice.`);
      seen.add(key);
      inputs.push({ type, id, access });
    });

    const companies = companyIds.size > 0
      ? await manager.query(
        `SELECT id, name FROM companies WHERE tenant_id = app_current_tenant() AND id = ANY($1::uuid[])`,
        [[...companyIds]],
      )
      : [];
    const centers = centerIds.size > 0
      ? await manager.query(
        `SELECT id, code, name, kind FROM cost_centers WHERE tenant_id = app_current_tenant() AND id = ANY($1::uuid[])`,
        [[...centerIds]],
      )
      : [];
    // The ids a client sends may be upper case; PostgreSQL returns uuids in lower case.
    const companyById = new Map<string, { id: string; name: string }>(companies.map((row: any) => [String(row.id).toLowerCase(), row]));
    const centerById = new Map<string, { id: string; code: string; name: string; kind: string }>(centers.map((row: any) => [String(row.id).toLowerCase(), row]));
    const nodes: DetailedNode[] = inputs.map((input) => {
      if (input.type === 'all') {
        return {
          id: '',
          node_type: 'all',
          access: input.access,
          company_id: null,
          cost_center_id: null,
          company_name: null,
          cost_center_code: null,
          cost_center_name: null,
          cost_center_kind: null,
        };
      }
      if (input.type === 'company') {
        const company = companyById.get(input.id!);
        if (!company) throw badRequest('DATA_ACCESS_NODE_UNKNOWN', 'A company of the list does not exist in this tenant.', { id: input.id });
        return {
          id: '',
          node_type: 'company',
          access: input.access,
          company_id: company.id,
          cost_center_id: null,
          company_name: company.name,
          cost_center_code: null,
          cost_center_name: null,
          cost_center_kind: null,
        };
      }
      const center = centerById.get(input.id!);
      if (!center) throw badRequest('DATA_ACCESS_NODE_UNKNOWN', 'A cost center of the list does not exist in this tenant.', { id: input.id });
      return {
        id: '',
        node_type: 'cost_center',
        access: input.access,
        company_id: null,
        cost_center_id: center.id,
        company_name: null,
        cost_center_code: center.code,
        cost_center_name: center.name,
        cost_center_kind: center.kind,
      };
    });
    return { mode, nodes: nodes.sort(compareDetailedNodes) };
  }

  private async storedState(manager: EntityManager, userId: string): Promise<{ mode: DataAccessMode; nodes: DetailedNode[] }> {
    const [row]: Array<{ data_access_mode: string }> = await manager.query(
      `SELECT data_access_mode FROM users WHERE tenant_id = app_current_tenant() AND id = $1`,
      [userId],
    );
    const mode: DataAccessMode = row?.data_access_mode === 'limited' ? 'limited' : 'all';
    return { mode, nodes: await readNodes(manager, userId) };
  }

  private async writeProposal(
    manager: EntityManager,
    targetId: string,
    proposal: Proposal,
    callerId: string | null,
    source: 'screen' | 'import',
    opts: { audit?: boolean } = {},
  ): Promise<boolean> {
    const before = await this.storedState(manager, targetId);
    const after = snapshotOf(proposal.mode, proposal.nodes);
    if (sameSnapshot(before.mode, before.nodes, proposal.mode, proposal.nodes)) return false;

    await manager.query(
      `UPDATE users
          SET data_access_mode = $2,
              data_access_updated_at = now(),
              data_access_updated_by = $3
        WHERE tenant_id = app_current_tenant() AND id = $1`,
      [targetId, proposal.mode, callerId],
    );
    await manager.query(
      `DELETE FROM user_data_access_nodes WHERE tenant_id = app_current_tenant() AND user_id = $1`,
      [targetId],
    );
    for (const node of proposal.nodes) {
      await manager.query(
        `INSERT INTO user_data_access_nodes
           (tenant_id, user_id, node_type, company_id, cost_center_id, access, created_by)
         VALUES (app_current_tenant(), $1, $2, $3, $4, $5, $6)`,
        [targetId, node.node_type, node.company_id, node.cost_center_id, node.access, callerId],
      );
    }
    if (opts.audit !== false) {
      await this.audit.log(
        {
          table: 'user_data_access',
          recordId: targetId,
          action: 'update',
          before: snapshotOf(before.mode, before.nodes),
          after,
          userId: callerId,
          source,
        },
        { manager },
      );
    }
    return true;
  }

  private async lockAccess(manager: EntityManager): Promise<void> {
    await manager.query(`SELECT pg_advisory_xact_lock(hashtext('data-access:' || app_current_tenant()::text)::bigint)`);
  }

  private async countUnscoped(manager: EntityManager): Promise<AccessPreview> {
    const [row] = await manager.query(
      `WITH line_counts AS (
         SELECT count(*)::int AS lines,
                count(*) FILTER (WHERE ${lineEditableSql('i.')})::int AS editable_lines
           FROM spend_items i
          WHERE i.tenant_id = app_current_tenant() ${naturesAnd('i', ['opex', 'capex'])}
       )
       SELECT line_counts.lines, line_counts.editable_lines,
              (SELECT count(*)::int FROM contracts c
                WHERE c.tenant_id = app_current_tenant()) AS contracts
         FROM line_counts`,
    );
    return { lines: Number(row?.lines ?? 0), editable_lines: Number(row?.editable_lines ?? 0), contracts: Number(row?.contracts ?? 0) };
  }

  private async countUnderPolicies(manager: EntityManager): Promise<AccessPreview> {
    return this.countUnscoped(manager);
  }

  /**
   * After the preview: the caller's access, not the target's. `current_setting('role')` is `none`
   * when no role is taken (the app role); `app.da_mode` is empty. A mismatch throws: the request
   * must not go on with another person's access.
   */
  private async assertUnscopedRestored(manager: EntityManager): Promise<void> {
    const [row] = await manager.query(
      `SELECT current_setting('role', true) AS role,
              current_setting('app.da_mode', true) AS mode,
              current_user AS current_user,
              session_user AS session_user`,
    );
    const role = row?.role == null ? 'none' : String(row.role);
    const mode = row?.mode == null ? '' : String(row.mode);
    if (mode !== '' || (role !== 'none' && role !== '')) {
      throw new Error(`Data-access preview: the caller's role was not restored (role ${role}, mode ${mode}).`);
    }
    if (row?.current_user !== row?.session_user) {
      throw new Error('Data-access preview: the caller is not the application role after the preview.');
    }
  }

  private chooseCompanyNode(nodes: DetailedNode[], tree: AccessTree): DetailedNode {
    const rank = (node: DetailedNode) => node.node_type === 'all' ? 0 : node.node_type === 'company' ? 1 : 2;
    const label = (node: DetailedNode) => node.node_type === 'company'
      ? tree.companies.get(node.company_id ?? '')?.name ?? ''
      : node.node_type === 'cost_center'
        ? tree.centers.get(node.cost_center_id ?? '')?.code ?? ''
        : '';
    return [...nodes].sort((a, b) => {
      const access = Number(b.access === 'edit') - Number(a.access === 'edit');
      if (access !== 0) return access;
      const type = rank(a) - rank(b);
      if (type !== 0) return type;
      const labelOrder = label(a).toLowerCase().localeCompare(label(b).toLowerCase());
      if (labelOrder !== 0) return labelOrder;
      return a.id.localeCompare(b.id);
    })[0];
  }

  /** Limited, non-Administrator persons with their nodes: the input of the "who sees" routes. */
  private async loadLimitedPersons(
    manager: EntityManager,
    tenantId: string,
  ): Promise<Array<{ id: string; name: string; email: string; nodes: DetailedNode[] }>> {
    const rows: Array<{
      id: string;
      first_name: string | null;
      last_name: string | null;
      email: string;
      node_id: string | null;
      node_type: string | null;
      access: string | null;
      company_id: string | null;
      cost_center_id: string | null;
      company_name: string | null;
      cost_center_code: string | null;
      cost_center_name: string | null;
      cost_center_kind: string | null;
    }> = await manager.query(
      `SELECT u.id, u.first_name, u.last_name, u.email,
              n.id AS node_id, n.node_type, n.access, n.company_id, n.cost_center_id,
              co.name AS company_name, cc.code AS cost_center_code, cc.name AS cost_center_name,
              cc.kind AS cost_center_kind
         FROM users u
         LEFT JOIN user_data_access_nodes n ON n.tenant_id = u.tenant_id AND n.user_id = u.id
         LEFT JOIN companies co ON co.tenant_id = u.tenant_id AND co.id = n.company_id
         LEFT JOIN cost_centers cc ON cc.tenant_id = u.tenant_id AND cc.id = n.cost_center_id
        WHERE u.tenant_id = $1
          AND u.data_access_mode = 'limited'
          AND NOT EXISTS (
            SELECT 1
            FROM (
              SELECT u.role_id
              UNION
              SELECT ur.role_id FROM user_roles ur WHERE ur.user_id = u.id AND ur.tenant_id = u.tenant_id
            ) assigned
            JOIN roles r ON r.id = assigned.role_id AND r.tenant_id = u.tenant_id
            WHERE lower(trim(r.role_name)) = 'administrator'
          )
        ORDER BY lower(coalesce(nullif(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email)),
                 u.id,
                 CASE n.node_type WHEN 'all' THEN 0 WHEN 'company' THEN 1 ELSE 2 END,
                 lower(co.name), lower(cc.code), n.id`,
      [tenantId],
    );
    const persons = new Map<string, { id: string; name: string; email: string; nodes: DetailedNode[] }>();
    for (const row of rows) {
      const person = persons.get(row.id) ?? {
        id: row.id,
        name: personName(row.first_name, row.last_name, row.email),
        email: row.email,
        nodes: [] as DetailedNode[],
      };
      if (row.node_id) {
        person.nodes.push({
          id: row.node_id,
          node_type: row.node_type === 'company' || row.node_type === 'cost_center' ? row.node_type : 'all',
          access: row.access === 'edit' ? 'edit' : 'read',
          company_id: row.company_id,
          cost_center_id: row.cost_center_id,
          company_name: row.company_name,
          cost_center_code: row.cost_center_code,
          cost_center_name: row.cost_center_name,
          cost_center_kind: row.cost_center_kind,
        });
      }
      persons.set(row.id, person);
    }
    return [...persons.values()];
  }
}
