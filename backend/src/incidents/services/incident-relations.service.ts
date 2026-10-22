import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, EntityTarget, In, ObjectLiteral, Repository } from 'typeorm';
import { Incident } from '../incident.entity';
import { IncidentAsset } from '../incident-asset.entity';
import { IncidentApplication } from '../incident-application.entity';
import { IncidentTechnology } from '../incident-technology.entity';
import { AuditService } from '../../audit/audit.service';
import {
  applicationParticipantCondition,
  type ParticipationAccessScope,
} from '../../auth/business-contributor-scope';
import {
  binder,
  listRelatedApplications,
  listRelatedAssets,
  listRelatedTechnologies,
  type RelationLinkTable,
} from '../../common/relations/related-objects';
import { parseTargetId } from '../../common/relations/relation-target';
import { isFrozenIncidentStatus } from '../incident-visibility';
import { IncidentsBaseService, ServiceOpts } from './incidents-base.service';

export type IncidentLinkedObject = { id: string; name: string; reference: string | null };

type LinkSpec = {
  /** Sentence-case label used in the journal ("Assets linked: …"). */
  label: string;
  /** Key in `changed_fields`. */
  key: 'assets' | 'applications' | 'technologies';
  entity: EntityTarget<ObjectLiteral>;
  linkTable: 'incident_assets' | 'incident_applications' | 'incident_technologies';
  linkColumn: 'asset_id' | 'application_id' | 'technology_id';
  targetTable: 'assets' | 'applications' | 'technologies';
  /** Business reference shown next to the name, as SQL over the target table aliased `t`. */
  reference: string;
  /** 404 when the target id is a uuid of another tenant, or of no row. */
  notFound: string;
};

export const INCIDENT_RELATION_KINDS = ['assets', 'applications', 'technologies'] as const;
export type IncidentRelationKind = (typeof INCIDENT_RELATION_KINDS)[number];

/** 404 for a relation kind the incident tab does not write. */
export function incidentRelationKindOrThrow(value: string): IncidentRelationKind {
  if (!(INCIDENT_RELATION_KINDS as readonly string[]).includes(value)) {
    throw new NotFoundException('Unknown relation type.');
  }
  return value as IncidentRelationKind;
}

/** One list of suggested technologies, not one cap per source. A constant, never a request value. */
const SUGGESTION_LIMIT = 20;

const INCIDENT_ASSET_ROWS: RelationLinkTable & { target: string } = {
  links: 'incident_assets', owner: 'incident_id', target: 'asset_id',
};
const INCIDENT_APPLICATION_ROWS: RelationLinkTable & { target: string } = {
  links: 'incident_applications', owner: 'incident_id', target: 'application_id',
};
const INCIDENT_TECHNOLOGY_ROWS: RelationLinkTable & { target: string } = {
  links: 'incident_technologies', owner: 'incident_id', target: 'technology_id',
};

export type IncidentTechnologySuggestion = {
  type: 'technology';
  id: string;
  reference: string;
  name: string;
  family: string;
  vendor: string | null;
  via: { kind: 'asset_technology' | 'application_technology'; label: string };
};

const ASSET_LINK: LinkSpec = {
  label: 'Assets',
  key: 'assets',
  entity: IncidentAsset,
  linkTable: 'incident_assets',
  linkColumn: 'asset_id',
  targetTable: 'assets',
  reference: 't.asset_reference',
  notFound: 'Asset not found.',
};

const APPLICATION_LINK: LinkSpec = {
  label: 'Applications',
  key: 'applications',
  entity: IncidentApplication,
  linkTable: 'incident_applications',
  linkColumn: 'application_id',
  targetTable: 'applications',
  reference: 't.sequential_id',
  notFound: 'Application not found.',
};

const TECHNOLOGY_LINK: LinkSpec = {
  label: 'Technologies',
  key: 'technologies',
  entity: IncidentTechnology,
  linkTable: 'incident_technologies',
  linkColumn: 'technology_id',
  targetTable: 'technologies',
  reference: `'TEC-' || t.item_number`,
  notFound: 'Technology not found.',
};

const LINK_BY_KIND: Record<IncidentRelationKind, LinkSpec> = {
  assets: ASSET_LINK,
  applications: APPLICATION_LINK,
  technologies: TECHNOLOGY_LINK,
};

const displayRef = (item: IncidentLinkedObject): string => item.reference || item.name;

/**
 * Linked assets / applications / technologies, replaced as a whole and journaled as one `link_change` entry.
 */
@Injectable()
export class IncidentRelationsService extends IncidentsBaseService {
  constructor(
    @InjectRepository(Incident) incidentRepo: Repository<Incident>,
    private readonly audit: AuditService,
  ) {
    super(incidentRepo);
  }

  listAssets(incidentId: string, opts?: ServiceOpts): Promise<IncidentLinkedObject[]> {
    return this.listLinked(ASSET_LINK, incidentId, opts);
  }

  bulkReplaceAssets(incidentId: string, assetIds: string[], userId: string | null, opts?: ServiceOpts) {
    return this.bulkReplace(ASSET_LINK, incidentId, assetIds, userId, opts);
  }

  listApplications(incidentId: string, opts?: ServiceOpts): Promise<IncidentLinkedObject[]> {
    return this.listLinked(APPLICATION_LINK, incidentId, opts);
  }

  bulkReplaceApplications(incidentId: string, applicationIds: string[], userId: string | null, opts?: ServiceOpts) {
    return this.bulkReplace(APPLICATION_LINK, incidentId, applicationIds, userId, opts);
  }

  listTechnologies(incidentId: string, opts?: ServiceOpts): Promise<IncidentLinkedObject[]> {
    return this.listLinked(TECHNOLOGY_LINK, incidentId, opts);
  }

  bulkReplaceTechnologies(incidentId: string, technologyIds: string[], userId: string | null, opts?: ServiceOpts) {
    return this.bulkReplace(TECHNOLOGY_LINK, incidentId, technologyIds, userId, opts);
  }

  /**
   * Link (`add`) or unlink one technology, from the technology's side (`setLinkFromTarget`).
   */
  setTechnologyLink(incidentId: string, technologyId: string, add: boolean, userId: string | null, opts?: ServiceOpts): Promise<{ changed: boolean }> {
    return this.setLinkFromTarget(TECHNOLOGY_LINK, incidentId, technologyId, add, userId, opts);
  }

  /**
   * Link (`add`) or unlink one application, from the application's side (lot R1b, `setLinkFromTarget`).
   */
  setApplicationLink(incidentId: string, applicationId: string, add: boolean, userId: string | null, opts?: ServiceOpts): Promise<{ changed: boolean }> {
    return this.setLinkFromTarget(APPLICATION_LINK, incidentId, applicationId, add, userId, opts);
  }

  /**
   * The Relations tab in one round trip. `assets` and `technologies` are null without a read of
   * the infrastructure (`opts.technologies`); `applications` is null without a read of applications.
   * A Business Contributor's `applicationScope` narrows the applications. `editable` is false on a
   * closed or cancelled incident, and that incident has no suggestions (nothing can be linked).
   */
  async getRelations(incidentId: string, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const tenantId = this.ensureTenantId(opts?.tenantId);
    const incident = await this.ensureIncident(incidentId, mg, tenantId, opts?.viewer);
    const editable = !isFrozenIncidentStatus(incident.status);
    const readsInfrastructure = opts?.technologies === true;
    const readsApplications = opts?.applications === true;
    const assets = readsInfrastructure
      ? await listRelatedAssets(mg, INCIDENT_ASSET_ROWS, tenantId, incident.id)
      : null;
    const applications = readsApplications
      ? await listRelatedApplications(mg, INCIDENT_APPLICATION_ROWS, tenantId, incident.id, opts?.applicationScope)
      : null;
    const technologies = readsInfrastructure
      ? await listRelatedTechnologies(mg, INCIDENT_TECHNOLOGY_ROWS, tenantId, incident.id)
      : null;
    const suggestions = editable && readsInfrastructure
      ? await this.suggestTechnologies(mg, tenantId, incident.id, readsApplications, opts?.applicationScope)
      : [];
    return { assets, applications, technologies, editable, suggestions };
  }

  /**
   * Link (`add`) or unlink one asset, application or technology from the incident's side.
   * The caller has already checked the module read. A uuid that is not a row of the tenant is
   * 404. A closed or cancelled incident is refused before that check. Linking what is linked,
   * or unlinking what is not, changes nothing: no journal entry and no audit row. The write
   * itself is `setLinkFromTarget` (lock, `link_change`, audit).
   */
  async setLink(
    kind: IncidentRelationKind,
    incidentId: string,
    targetId: string,
    add: boolean,
    userId: string | null,
    opts?: ServiceOpts,
  ): Promise<{ ok: true; changed: boolean }> {
    const spec = LINK_BY_KIND[kind];
    const id = parseTargetId(targetId);
    const mg = this.getManager(opts);
    const tenantId = this.ensureTenantId(opts?.tenantId);
    const incident = await this.ensureIncident(incidentId, mg, tenantId, opts?.viewer);
    this.assertEditable(incident);
    // A Business Contributor links and unlinks only the applications they take part in; any other reads as missing.
    const params: unknown[] = [tenantId, id];
    const scope = kind === 'applications' ? opts?.applicationScope : undefined;
    const inScope = scope ? ` AND ${applicationParticipantCondition('t', binder(params)(scope.userId))}` : '';
    const found: unknown[] = await mg.query(
      `SELECT 1 FROM ${spec.targetTable} t WHERE t.tenant_id = $1 AND t.id = $2${inScope}`,
      params,
    );
    if (found.length === 0) throw new NotFoundException(spec.notFound);
    const res = await this.setLinkFromTarget(spec, incident.id, id, add, userId, opts);
    return { ok: true, changed: res.changed };
  }

  /**
   * Link (`add`) or unlink one object from the object's side. The incident must be visible to the
   * viewer (404 otherwise, the same answer whether it exists or not) and open; its row is locked
   * (FOR NO KEY UPDATE) before the set is read, so two links made at once from two objects both
   * stay. Linking what is linked, or unlinking what is not, changes nothing.
   */
  private async setLinkFromTarget(
    spec: LinkSpec,
    incidentId: string,
    targetId: string,
    add: boolean,
    userId: string | null,
    opts?: ServiceOpts,
  ): Promise<{ changed: boolean }> {
    const mg = this.getManager(opts);
    const tenantId = this.ensureTenantId(opts?.tenantId);
    const incident = await this.ensureIncident(incidentId, mg, tenantId, opts?.viewer);
    this.assertEditable(incident);
    await mg.query(`SELECT 1 FROM incidents WHERE tenant_id = $1 AND id = $2 FOR NO KEY UPDATE`, [tenantId, incident.id]);
    const current: Array<{ id: string }> = await mg.query(
      `SELECT ${spec.linkColumn}::text AS id FROM ${spec.linkTable} WHERE tenant_id = $1 AND incident_id = $2`,
      [tenantId, incident.id],
    );
    const ids = current.map((row) => row.id);
    if (ids.includes(targetId) === add) return { changed: false };
    const next = add ? [...ids, targetId] : ids.filter((value) => value !== targetId);
    await this.bulkReplace(spec, incident.id, next, userId, opts);
    return { changed: true };
  }

  /**
   * The journal of an application converted to a technology (lot C1): one link change per incident
   * whose application link became the technology's, written in the caller's transaction. The
   * incidents are not checked for visibility or state: no new object is linked.
   */
  async journalApplicationConversion(
    incidentIds: string[],
    application: string,
    technology: string,
    userId: string | null,
    opts: { manager: EntityManager; tenantId: string },
  ): Promise<void> {
    for (const id of incidentIds) {
      await this.addEntry(opts.manager, { id, tenant_id: opts.tenantId } as Incident, {
        kind: 'link_change',
        content: `Application ${application} converted to technology ${technology}.`,
        changed_fields: { applications: { from: [application], to: [] }, technologies: { from: [], to: [technology] } },
        author_id: userId,
      });
    }
  }

  /**
   * Technologies of the assets linked to the incident, and of the applications the caller can
   * see, that the incident does not list yet. At most `SUGGESTION_LIMIT`. When several sources
   * carry one technology, the first source reference in alphabetical order wins (`APP-1` before
   * `AST-2`). A source with no reference is left out.
   */
  private async suggestTechnologies(
    mg: EntityManager,
    tenantId: string,
    incidentId: string,
    includeApplications: boolean,
    scope?: ParticipationAccessScope,
  ): Promise<IncidentTechnologySuggestion[]> {
    const params: unknown[] = [tenantId, incidentId];
    const bind = binder(params);
    const applicationBranch = includeApplications
      ? `UNION ALL
         SELECT apt.technology_id,
                'application_technology'::text AS via_kind,
                a.sequential_id AS via_label
           FROM incident_applications l
           JOIN applications a ON a.id = l.application_id AND a.tenant_id = l.tenant_id
           JOIN application_technologies apt
             ON apt.application_id = a.id AND apt.tenant_id = a.tenant_id
          WHERE l.tenant_id = $1 AND l.incident_id = $2
            AND a.sequential_id IS NOT NULL
            ${scope ? `AND ${applicationParticipantCondition('a', bind(scope.userId))}` : ''}`
      : '';
    const rows: Array<{
      id: string;
      reference: string;
      name: string;
      family: string;
      vendor: string | null;
      via_kind: IncidentTechnologySuggestion['via']['kind'];
      via_label: string;
    }> = await mg.query(
      `SELECT id, reference, name, family, vendor, via_kind, via_label
         FROM (
           SELECT t.id,
                  'TEC-' || t.item_number AS reference,
                  t.name,
                  t.family,
                  t.editor AS vendor,
                  src.via_kind,
                  src.via_label,
                  row_number() OVER (
                    PARTITION BY t.id
                    ORDER BY src.via_label ASC NULLS LAST, src.via_kind ASC
                  ) AS rn
             FROM (
               SELECT at.technology_id,
                      'asset_technology'::text AS via_kind,
                      s.asset_reference AS via_label
                 FROM incident_assets l
                 JOIN assets s ON s.id = l.asset_id AND s.tenant_id = l.tenant_id
                 JOIN asset_technologies at
                   ON at.asset_id = s.id AND at.tenant_id = s.tenant_id
                WHERE l.tenant_id = $1 AND l.incident_id = $2
                  AND s.asset_reference IS NOT NULL
               ${applicationBranch}
             ) src
             JOIN technologies t ON t.id = src.technology_id AND t.tenant_id = $1
            WHERE NOT EXISTS (
              SELECT 1 FROM incident_technologies it
               WHERE it.tenant_id = $1 AND it.incident_id = $2 AND it.technology_id = t.id
            )
         ) ranked
        WHERE rn = 1
        ORDER BY lower(name), id
        LIMIT ${SUGGESTION_LIMIT}`,
      params,
    );
    return rows.map((row) => ({
      type: 'technology',
      id: row.id,
      reference: row.reference,
      name: row.name,
      family: row.family,
      vendor: row.vendor ?? null,
      via: { kind: row.via_kind, label: row.via_label },
    }));
  }

  private async listLinked(spec: LinkSpec, incidentId: string, opts?: ServiceOpts): Promise<IncidentLinkedObject[]> {
    const mg = this.getManager(opts);
    const tenantId = this.ensureTenantId(opts?.tenantId);
    await this.ensureIncident(incidentId, mg, tenantId, opts?.viewer);
    return mg.query(
      `SELECT t.id, t.name, ${spec.reference} AS reference
       FROM ${spec.linkTable} l
       JOIN ${spec.targetTable} t ON t.id = l.${spec.linkColumn} AND t.tenant_id = l.tenant_id
       WHERE l.incident_id = $1 AND l.tenant_id = $2
       ORDER BY t.name ASC`,
      [incidentId, tenantId],
    );
  }

  private async bulkReplace(
    spec: LinkSpec,
    incidentId: string,
    rawIds: string[],
    userId: string | null,
    opts?: ServiceOpts,
  ): Promise<IncidentLinkedObject[]> {
    const mg = this.getManager(opts);
    const tenantId = this.ensureTenantId(opts?.tenantId);
    const incident = await this.ensureIncident(incidentId, mg, tenantId, opts?.viewer);
    this.assertEditable(incident);
    // The incident row first: a concurrent replacement of its links waits, then reads what this one wrote.
    await mg.query(`SELECT 1 FROM incidents WHERE tenant_id = $1 AND id = $2 FOR NO KEY UPDATE`, [tenantId, incident.id]);

    const nextIds = Array.from(new Set((rawIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
    const targets: IncidentLinkedObject[] = nextIds.length
      ? await mg.query(
          `SELECT t.id, t.name, ${spec.reference} AS reference
           FROM ${spec.targetTable} t
           WHERE t.id = ANY($1::uuid[]) AND t.tenant_id = $2`,
          [nextIds, tenantId],
        )
      : [];
    if (targets.length !== nextIds.length) {
      throw new BadRequestException(`One or more ${spec.label.toLowerCase()} not found`);
    }

    // The viewer goes along: without it a confidential incident reads as missing, even to its reporter.
    const current = await this.listLinked(spec, incidentId, { manager: mg, tenantId, viewer: opts?.viewer });
    const currentIds = new Set(current.map((item) => item.id));
    const wantedIds = new Set(nextIds);
    const removed = current.filter((item) => !wantedIds.has(item.id));
    const added = targets.filter((item) => !currentIds.has(item.id));
    if (removed.length === 0 && added.length === 0) return current;

    const repo = mg.getRepository(spec.entity);
    if (removed.length) {
      await repo.delete({ incident_id: incident.id, tenant_id: tenantId, [spec.linkColumn]: In(removed.map((item) => item.id)) });
    }
    if (added.length) {
      await repo.save(added.map((item) => repo.create({ tenant_id: tenantId, incident_id: incident.id, [spec.linkColumn]: item.id })));
    }

    const next = await this.listLinked(spec, incidentId, { manager: mg, tenantId, viewer: opts?.viewer });
    const parts: string[] = [];
    if (added.length) parts.push(`${spec.label} linked: ${added.map(displayRef).join(', ')}`);
    if (removed.length) parts.push(`${spec.label} unlinked: ${removed.map(displayRef).join(', ')}`);
    await this.addEntry(mg, incident, {
      kind: 'link_change',
      content: `${parts.join('. ')}.`,
      changed_fields: { [spec.key]: { from: current.map(displayRef), to: next.map(displayRef) } },
      author_id: userId,
    });
    await this.audit.log(
      {
        table: spec.linkTable,
        recordId: incident.id,
        action: 'update',
        before: current.map((item) => item.id),
        after: next.map((item) => item.id),
        userId,
      },
      { manager: mg },
    );
    return next;
  }
}
