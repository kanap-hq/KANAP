import { Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { ParticipationAccessScope } from '../auth/business-contributor-scope';
import { moduleRightRequired } from '../auth/module-right-required';
import { readRelationsBudgetColumn } from '../common/relations/relations-budget-column';
import { setOwnedLink } from '../common/relations/owned-link';
import { parseTargetId } from '../common/relations/relation-target';
import {
  readRelatedBudgetLines,
  listRelatedContracts,
  listRelatedIncidents,
  listRelatedProjects,
  type RelatedBudgetLine,
  type RelatedContract,
  type RelatedIncident,
  type RelatedProject,
} from '../common/relations/related-objects';
import { FxRateService } from '../currency/fx-rate.service';
import { type IncidentViewer } from '../incidents/incident-visibility';
import { IncidentRelationsService } from '../incidents/services/incident-relations.service';
import { hiddenContractCount } from '../data-access/hidden-links';
import { readTechnology } from './technology-rows';

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

export type TechnologyRelations = {
  year: number;
  budget_column: { key: string; label: string };
  budget_lines: RelatedBudgetLine[] | null;
  /** The linked lines `budget_lines` leaves out, counted (`readRelatedBudgetLines`). */
  budget_lines_hidden: number;
  contracts: RelatedContract[] | null;
  /** The linked contracts the contracts policy hides from a limited person (spec §5.4). */
  contracts_hidden: number;
  projects: RelatedProject[] | null;
  incidents: RelatedIncident[] | null;
  documents: Array<{ id: string; original_filename: string; mime_type: string | null; size: number; uploaded_at: string }>;
  links: Array<{ id: string; description: string | null; url: string; created_at: string }>;
};

const LINE_LINKS = { links: 'technology_spend_items', owner: 'technology_id' };
const CONTRACT_LINKS = { links: 'technology_contracts', owner: 'technology_id' };
const PROJECT_LINKS = { links: 'technology_projects', owner: 'technology_id' };

/** The link tables a technology owns, written by `setOwnedLink`. Names come only from here. */
const OWNED = {
  budget_lines: { table: 'technology_spend_items', ownerColumn: 'technology_id', targetColumn: 'spend_item_id', notFound: 'Budget line not found.' },
  contracts: { table: 'technology_contracts', ownerColumn: 'technology_id', targetColumn: 'contract_id', notFound: 'Contract not found.' },
  projects: { table: 'technology_projects', ownerColumn: 'technology_id', targetColumn: 'project_id', notFound: 'One or more projects were not found.' },
} as const;

/**
 * The Relations tab of a technology, on the model of the applications' (lot R1): one round trip
 * for the budget lines (amount on the tenant's default column for the current year), contracts,
 * projects, incidents, documents and web links; a section the caller cannot read is null. A single
 * link or unlink locks the technology's row (FOR NO KEY UPDATE), reads the stored set and replaces
 * it with that set plus or minus one id: a link another user made meanwhile stays. The technology's
 * own link tables are written by `setOwnedLink` with one audit row per change (as
 * `ApplicationsInstancesService` does); an incident's links are written by `IncidentRelationsService`,
 * which checks the incident is visible and open and records the change in its journal.
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
    const { year, measure, budget_column } = await readRelationsBudgetColumn(mg, tenantId);
    // One after the other: the request's single connection runs its queries in turn anyway.
    const budget = await readRelatedBudgetLines(mg, this.fxRates, LINE_LINKS, 'technology', tenantId, tech.id, year, measure, ctx.access.budget_lines);
    const contracts = ctx.access.contracts ? await listRelatedContracts(mg, CONTRACT_LINKS, tenantId, tech.id) : null;
    const contractsHidden = ctx.access.contracts ? await hiddenContractCount(mg, 'technology', tech.id) : 0;
    const projects = ctx.access.projects ? await listRelatedProjects(mg, PROJECT_LINKS, tenantId, tech.id, ctx.projectScope) : null;
    const incidents = ctx.access.incidents
      ? await listRelatedIncidents(mg, tenantId, { table: 'incident_technologies', column: 'technology_id' }, tech.id, ctx.incidentViewer)
      : null;
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
      budget_column,
      ...budget,
      contracts,
      contracts_hidden: contractsHidden,
      projects,
      incidents,
      documents,
      links,
    };
  }

  /**
   * Link (`add`) or unlink one object. Linking what is linked, or unlinking what is not, changes
   * nothing and writes no audit row.
   */
  async setLink(kind: TechnologyRelationKind, idOrRef: string, targetId: string, add: boolean, ctx: TechnologyRelationsContext): Promise<{ ok: true; changed: boolean }> {
    const mg = ctx.manager;
    if (kind === 'incidents') {
      if (!ctx.access.incidents) throw moduleRightRequired('incidents', 'reader', 'You cannot read this module.');
      const id = parseTargetId(targetId);
      // The technology row is locked first (FOR NO KEY UPDATE): two links on one technology wait
      // on this row. The incident service then checks visibility, the open state, and records the
      // change in the journal.
      const tech = await readTechnology(mg, ctx.tenantId, idOrRef, true);
      if (!ctx.writeIncidents) throw moduleRightRequired('incidents', 'contributor', 'You cannot edit incidents.');
      const res = await this.incidents.setTechnologyLink(id, tech.id, add, ctx.userId, { manager: mg, tenantId: tech.tenant_id, viewer: ctx.incidentViewer });
      return { ok: true, changed: res.changed };
    }
    return setOwnedLink({
      manager: mg,
      userId: ctx.userId,
      kind,
      targetId,
      add,
      allowed: ctx.access[kind],
      loadOwner: async () => {
        const tech = await readTechnology(mg, ctx.tenantId, idOrRef);
        return { id: tech.id, tenantId: tech.tenant_id };
      },
      owner: { table: 'technologies', idColumn: 'id' },
      ownerNotFound: 'Technology not found',
      link: OWNED[kind],
      projectScope: ctx.projectScope,
      audit: this.audit,
    });
  }
}

export function technologyRelationKindOrThrow(value: string): TechnologyRelationKind {
  if (!(TECHNOLOGY_RELATION_KINDS as readonly string[]).includes(value)) throw new NotFoundException('Unknown relation type.');
  return value as TechnologyRelationKind;
}
