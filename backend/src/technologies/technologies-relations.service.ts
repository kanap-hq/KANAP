import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { ParticipationAccessScope, projectParticipantCondition } from '../auth/business-contributor-scope';
import { budgetColumnName, readBudgetColumns } from '../budget-columns/budget-columns.util';
import {
  binder,
  dateText,
  listRelatedBudgetLines,
  listRelatedContracts,
  listRelatedProjects,
  type RelatedBudgetLine,
  type RelatedContract,
  type RelatedProject,
} from '../common/relations/related-objects';
import { FxRateService } from '../currency/fx-rate.service';
import { incidentRelatedTitleSql, incidentVisibilitySql, type IncidentViewer } from '../incidents/incident-visibility';
import { IncidentRelationsService } from '../incidents/services/incident-relations.service';
import { BUDGET_NATURES, linkedLineOf, naturesAnd, type BudgetNature } from '../spend/budget-nature';
import { readTechnology, UUID_RE } from './technology-rows';

/** The kinds of objects the Relations tab of a technology links one by one. */
export const TECHNOLOGY_RELATION_KINDS = ['budget_lines', 'contracts', 'projects', 'incidents'] as const;
export type TechnologyRelationKind = (typeof TECHNOLOGY_RELATION_KINDS)[number];

/** Which modules the caller may read: a section the caller cannot read is `null`. */
export type TechnologyRelationsAccess = Record<TechnologyRelationKind, boolean>;

export type TechnologyRelationsContext = {
  manager: EntityManager;
  tenantId: string;
  userId: string | null;
  access: TechnologyRelationsAccess;
  /**
   * Linking an incident writes in the incident (its journal): it needs the level that edits an
   * incident (`incidents:contributor`), not only the read of its section.
   */
  writeIncidents: boolean;
  /** A Business Contributor's project scope, when the caller is one. */
  projectScope?: ParticipationAccessScope;
  /** Confidential incidents show only to their reporter, owner and the registry admins. */
  incidentViewer: IncidentViewer;
};

export type RelatedIncident = {
  id: string;
  item_number: number;
  title: string | null;
  status: string;
  severity: string;
  detected_at: string | null;
};

export type TechnologyRelations = {
  year: number;
  budget_column: { key: string; label: string };
  budget_lines: RelatedBudgetLine[] | null;
  contracts: RelatedContract[] | null;
  projects: RelatedProject[] | null;
  incidents: RelatedIncident[] | null;
  documents: Array<{ id: string; original_filename: string; mime_type: string | null; size: number; uploaded_at: string }>;
  links: Array<{ id: string; description: string | null; url: string; created_at: string }>;
};

const LINE_LINKS = { links: 'technology_spend_items', owner: 'technology_id' };
const CONTRACT_LINKS = { links: 'technology_contracts', owner: 'technology_id' };
const PROJECT_LINKS = { links: 'technology_projects', owner: 'technology_id' };

/** The link tables a technology owns, replaced by `replaceOwnedLinks`. Names come only from here. */
const OWNED = {
  budget_lines: { links: 'technology_spend_items', column: 'spend_item_id', notFound: 'Budget line not found.' },
  contracts: { links: 'technology_contracts', column: 'contract_id', notFound: 'Contract not found.' },
  projects: { links: 'technology_projects', column: 'project_id', notFound: 'One or more projects were not found.' },
} as const;

/**
 * The Relations tab of a technology, on the model of the applications' (lot R1): one round trip
 * for the budget lines (amount on the tenant's default column for the current year), contracts,
 * projects, incidents, documents and web links; a section the caller cannot read is null. A single
 * link or unlink locks the technology's row (FOR NO KEY UPDATE), reads the stored set and replaces
 * it with that set plus or minus one id: a link another user made meanwhile stays. The technology's
 * own link tables are written here with one audit row per change (as `ApplicationsInstancesService`
 * does); an incident's links are written by `IncidentRelationsService`, which checks the incident is
 * visible and open and records the change in its journal.
 */
@Injectable()
export class TechnologiesRelationsService {
  constructor(
    private readonly audit: AuditService,
    private readonly fxRates: FxRateService,
    private readonly incidents: IncidentRelationsService,
  ) {}

  async getRelations(idOrRef: string, ctx: TechnologyRelationsContext): Promise<TechnologyRelations> {
    const mg = ctx.manager;
    const tech = await readTechnology(mg, ctx.tenantId, idOrRef);
    const tenantId = tech.tenant_id;
    const year = new Date().getUTCFullYear();
    const columns = await readBudgetColumns(mg, tenantId);
    const measure = columns.default_column;
    // One after the other: the request's single connection runs its queries in turn anyway.
    const budgetLines = ctx.access.budget_lines ? await listRelatedBudgetLines(mg, this.fxRates, LINE_LINKS, tenantId, tech.id, year, measure) : null;
    const contracts = ctx.access.contracts ? await listRelatedContracts(mg, CONTRACT_LINKS, tenantId, tech.id) : null;
    const projects = ctx.access.projects ? await listRelatedProjects(mg, PROJECT_LINKS, tenantId, tech.id, ctx.projectScope) : null;
    const incidents = ctx.access.incidents ? await this.listIncidents(mg, tenantId, tech.id, ctx.incidentViewer) : null;
    const documents = await mg.query(
      `SELECT id, original_filename, mime_type, size, uploaded_at FROM technology_attachments
        WHERE tenant_id = $1 AND technology_id = $2 ORDER BY uploaded_at DESC, id`,
      [tenantId, tech.id],
    );
    const links = await mg.query(
      `SELECT id, description, url, created_at FROM technology_links WHERE tenant_id = $1 AND technology_id = $2 ORDER BY created_at DESC, id`,
      [tenantId, tech.id],
    );
    return {
      year,
      budget_column: { key: measure, label: budgetColumnName(columns, measure) },
      budget_lines: budgetLines,
      contracts,
      projects,
      incidents,
      documents,
      links,
    };
  }

  /** Incidents linked to the technology that the caller may see (confidential ones by their rule). */
  private async listIncidents(mg: EntityManager, tenantId: string, technologyId: string, viewer: IncidentViewer): Promise<RelatedIncident[]> {
    const params: unknown[] = [tenantId, technologyId];
    const visible = incidentVisibilitySql('i', viewer, params);
    return mg.query(
      `SELECT i.id, i.item_number, ${incidentRelatedTitleSql('i')} AS title, i.status::text AS status, i.severity::text AS severity,
              ${dateText('i.detected_at')} AS detected_at
         FROM incident_technologies l
         JOIN incidents i ON i.id = l.incident_id AND i.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.technology_id = $2${visible}
        ORDER BY i.detected_at DESC NULLS LAST, i.item_number DESC`,
      params,
    );
  }

  /**
   * Link (`add`) or unlink one object. Linking what is linked, or unlinking what is not, changes
   * nothing and writes no audit row.
   */
  async setLink(kind: TechnologyRelationKind, idOrRef: string, targetId: string, add: boolean, ctx: TechnologyRelationsContext): Promise<{ ok: true; changed: boolean }> {
    if (!ctx.access[kind]) throw new ForbiddenException('You cannot read this module.');
    const id = String(targetId || '').trim().toLowerCase();
    if (!UUID_RE.test(id)) throw new BadRequestException('Invalid id.');
    const mg = ctx.manager;
    const tech = await readTechnology(mg, ctx.tenantId, idOrRef, true);
    const tenantId = tech.tenant_id;

    if (kind === 'incidents') {
      // The incident's own service: visibility first, the open state, the incident row lock, the
      // journal entry and the audit; the set is read under that lock.
      if (!ctx.writeIncidents) throw new ForbiddenException('You cannot edit incidents.');
      const res = await this.incidents.setTechnologyLink(id, tech.id, add, ctx.userId, { manager: mg, tenantId, viewer: ctx.incidentViewer });
      return { ok: true, changed: res.changed };
    }

    const t = OWNED[kind];
    let nature: BudgetNature | undefined;
    if (kind === 'budget_lines') {
      const lines: Array<{ nature: BudgetNature }> = await mg.query(
        `SELECT nature FROM spend_items WHERE tenant_id = $1 AND id = $2${naturesAnd(null, BUDGET_NATURES)}`,
        [tenantId, id],
      );
      if (!lines[0]) throw new BadRequestException(t.notFound);
      nature = lines[0].nature;
    } else if (kind === 'contracts') {
      const rows = await mg.query(`SELECT 1 FROM contracts WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
      if (rows.length === 0) throw new BadRequestException(t.notFound);
    } else {
      await this.assertProjectVisible(mg, tenantId, id, ctx.projectScope);
    }
    const scopeSql = nature ? linkedLineOf('l.tenant_id', 'l.spend_item_id', nature) : '';
    const current: Array<{ id: string }> = await mg.query(
      `SELECT l.${t.column} AS id FROM ${t.links} l WHERE l.tenant_id = $1 AND l.technology_id = $2${scopeSql}`,
      [tenantId, tech.id],
    );
    const before = Array.from(new Set(current.map((row) => String(row.id).toLowerCase()))).sort();
    if (before.includes(id) === add) return { ok: true, changed: false };
    // A DELETE through the query runner returns [rows, count]: both writes are counted through a CTE.
    const [{ n }]: Array<{ n: number }> = await mg.query(
      add
        ? `WITH c AS (INSERT INTO ${t.links} (tenant_id, technology_id, ${t.column}) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING 1)
           SELECT count(*)::int AS n FROM c`
        : `WITH c AS (DELETE FROM ${t.links} WHERE tenant_id = $1 AND technology_id = $2 AND ${t.column} = $3 RETURNING 1)
           SELECT count(*)::int AS n FROM c`,
      [tenantId, tech.id, id],
    );
    if (Number(n) === 0) return { ok: true, changed: false };
    const after = (add ? [...before, id] : before.filter((value) => value !== id)).sort();
    await this.audit.log(
      { table: t.links, recordId: tech.id, action: 'update', before, after, userId: ctx.userId },
      { manager: mg },
    );
    return { ok: true, changed: true };
  }

  private async assertProjectVisible(mg: EntityManager, tenantId: string, projectId: string, scope?: ParticipationAccessScope) {
    const params: unknown[] = [tenantId, projectId];
    const bind = binder(params);
    const scopeSql = scope ? `AND ${projectParticipantCondition('p', bind(scope.userId))}` : '';
    const rows = await mg.query(`SELECT 1 FROM portfolio_projects p WHERE p.tenant_id = $1 AND p.id = $2 ${scopeSql}`, params);
    if (rows.length === 0) throw new BadRequestException('One or more projects were not found.');
  }
}

export function technologyRelationKindOrThrow(value: string): TechnologyRelationKind {
  if (!(TECHNOLOGY_RELATION_KINDS as readonly string[]).includes(value)) throw new NotFoundException('Unknown relation type.');
  return value as TechnologyRelationKind;
}
