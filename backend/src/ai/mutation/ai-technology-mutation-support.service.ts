import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { validate as isUuid } from 'uuid';
import { applicationParticipantCondition, type ParticipationAccessScope } from '../../auth/business-contributor-scope';
import { AuditService, type AuditSourceOptions } from '../../audit/audit.service';
import { readTechnology, resolveVersionLabel } from '../../technologies/technology-rows';
import {
  TechnologyLinksService,
  type ApplicationsReach,
  type DeploymentServer,
  type LinkOpts,
} from '../../technologies/technology-links.service';
import type { AiExecutionContextWithManager } from '../ai.types';
import { AiPolicyService } from '../ai-policy.service';
import { parseItemNumber } from '../../common/parse-item-number';
import { resolveAiParticipationAccessScope } from '../query/ai-query-scope.util';

/** A technology the link write resolved, with the reference and the screen's label. */
export type AiTechnologyTarget = {
  id: string;
  ref: string;
  name: string;
  label: string;
  family: string;
};

/** An application the link write may name, in the caller's Business Contributor scope. */
export type AiApplicationTarget = {
  id: string;
  ref: string;
  name: string;
  label: string;
};

/** A server the link write may name (any asset of the tenant). */
export type AiServerTarget = {
  id: string;
  ref: string;
  name: string;
  label: string;
};

/** A version of the technology, created or read, with the support dates the card shows. */
export type AiTechnologyVersion = {
  id: string | null;
  label: string;
  created: boolean;
  standard_support_end: string | null;
  extended_support_end: string | null;
};

/** A link row as the drift check and the undo read it. */
export type AiTechnologyLinkRow = {
  link_id: string;
  subject_id: string;
  version_id: string | null;
  version_label: string | null;
  notes: string | null;
  /** The preview that wrote the row (`ai`), null for a manual row: the undo requires its own. */
  source_ref: string | null;
};

/** The service options an assistant technology write passes to the link service. */
export type AiTechnologyWriteOptions = {
  manager: EntityManager;
  tenantId: string;
  userId: string | null;
  /** The caller reads applications: their participation scope narrows the applications they may name. */
  applications: boolean;
  applicationScope?: ParticipationAccessScope;
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function labelOf(ref: string | null, name: string | null, fallback: string): string {
  return [ref, name].map((part) => text(part)).filter(Boolean).join(' - ') || fallback;
}

/**
 * Shared resolution and reads of the technology link write (`update_technology_links`). The write
 * itself goes through `TechnologyLinksService`, never the tables: this service only resolves the
 * records the person named, reads the link rows the preview and the drift check compare, and reads
 * or creates a version through the same helper the screen uses (audited when it creates one).
 */
@Injectable()
export class AiTechnologyMutationSupportService {
  constructor(
    private readonly policy: AiPolicyService,
    private readonly links: TechnologyLinksService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The technology by TEC-n, UUID or exact name. A technology outside the tenant is refused at
   * preparation with what to do next: this tool never creates one, the model prepares a plan that
   * creates or adopts it, then writes the link or the versions.
   */
  async resolveTechnology(
    context: AiExecutionContextWithManager,
    reference: string,
  ): Promise<AiTechnologyTarget> {
    const raw = text(reference);
    if (!raw) throw new NotFoundException('Technology "" is not in this workspace.');
    const ref = raw.match(/^TEC-(\d+)$/i)?.[1] ?? null;
    const params: unknown[] = [context.tenantId, raw];
    params.push(ref == null ? null : parseItemNumber(ref));
    const rows: Array<{ id: string; item_number: number; name: string; family: string }> = await context.manager.query(
      `SELECT t.id, t.item_number, t.name, t.family
         FROM technologies t
        WHERE t.tenant_id = $1
          AND (${isUuid(raw) ? 't.id = $2::uuid OR ' : ''}($3::int IS NOT NULL AND t.item_number = $3::int)
               OR lower(btrim(t.name)) = lower(btrim($2)))
        ORDER BY lower(t.name), t.id
        LIMIT 6`,
      params,
    );
    if (rows.length === 0) {
      // One message whatever the calling tool: it prepares a creation or an adoption, then asks again.
      throw new NotFoundException(
        `Technology "${raw}" is not in this workspace. Prepare a plan that creates or adopts it `
        + '(create_business_record, entity_type technologies) first, then make this request again. '
        + 'This tool creates nothing.',
      );
    }
    if (rows.length > 1) throw new BadRequestException(`Multiple technologies matched "${raw}". Use a TEC reference or the UUID.`);
    const row = rows[0];
    const refLabel = `TEC-${row.item_number}`;
    return {
      id: String(row.id),
      ref: refLabel,
      name: String(row.name ?? ''),
      label: labelOf(refLabel, row.name, raw),
      family: String(row.family ?? ''),
    };
  }

  /** The technology row, locked `FOR NO KEY UPDATE`, as every link write locks it first. */
  async lockTechnology(context: AiExecutionContextWithManager, idOrRef: string): Promise<AiTechnologyTarget> {
    const row = await readTechnology(context.manager, context.tenantId, idOrRef, true);
    const ref = `TEC-${row.item_number}`;
    return {
      id: String(row.id),
      ref,
      name: String(row.name ?? ''),
      label: labelOf(ref, row.name, ref),
      family: String(row.family ?? ''),
    };
  }

  /** The write options: the application read and the Business Contributor's participation scope. */
  async writeOptions(context: AiExecutionContextWithManager): Promise<AiTechnologyWriteOptions> {
    const applications = await this.policy.canReadEntityType(context, 'applications', context.manager);
    return {
      manager: context.manager,
      tenantId: context.tenantId,
      userId: context.userId ?? null,
      applications,
      applicationScope: applications ? await resolveAiParticipationAccessScope(context, 'applications') : undefined,
    };
  }

  /** An application must be one the caller reads, in their scope; otherwise it reads as not found. */
  assertApplicationRead(context: AiExecutionContextWithManager): Promise<void> {
    return this.policy.assertBusinessPermission(context, 'applications', 'reader', context.manager);
  }

  /** The application by APP-n or exact name, within the Business Contributor's participation. */
  async resolveApplication(context: AiExecutionContextWithManager, options: AiTechnologyWriteOptions, reference: string): Promise<AiApplicationTarget> {
    const raw = text(reference);
    const params: unknown[] = [context.tenantId, raw];
    const scope = options.applicationScope
      ? (params.push(options.applicationScope.userId), ` AND ${applicationParticipantCondition('a', `$${params.length}`)}`)
      : '';
    const rows: Array<{ id: string; sequential_id: string | null; name: string }> = await context.manager.query(
      `SELECT a.id, a.sequential_id, a.name
         FROM applications a
        WHERE a.tenant_id = $1
          AND (upper(a.sequential_id) = upper(btrim($2)) OR lower(btrim(a.name)) = lower(btrim($2)))
          ${scope}
        ORDER BY lower(a.name), a.id
        LIMIT 6`,
      params,
    );
    if (rows.length === 0) throw new NotFoundException(`Application "${raw}" not found.`);
    if (rows.length > 1) throw new BadRequestException(`Multiple applications matched "${raw}". Use an APP reference.`);
    const row = rows[0];
    return {
      id: String(row.id),
      ref: text(row.sequential_id),
      name: String(row.name ?? ''),
      label: labelOf(row.sequential_id, row.name, raw),
    };
  }

  /**
   * The application a stored preview names is still one the caller reads, in their participation
   * scope: checked again under the technology lock before a declaration is written.
   */
  async assertApplicationInScope(
    context: AiExecutionContextWithManager,
    options: AiTechnologyWriteOptions,
    applicationId: string,
  ): Promise<void> {
    const params: unknown[] = [context.tenantId, applicationId];
    const scope = options.applicationScope
      ? (params.push(options.applicationScope.userId), ` AND ${applicationParticipantCondition('a', `$${params.length}`)}`)
      : '';
    const rows: Array<{ id: string }> = await context.manager.query(
      `SELECT a.id FROM applications a WHERE a.tenant_id = $1 AND a.id = $2 ${scope}`,
      params,
    );
    if (rows.length === 0) throw new NotFoundException('Application not found.');
  }

  /** The server by AST-n, UUID, exact name, hostname or fqdn, as the incident links read an asset. */
  async resolveServer(context: AiExecutionContextWithManager, reference: string): Promise<AiServerTarget> {
    const raw = text(reference);
    const params: unknown[] = [context.tenantId, raw];
    const rows: Array<{ id: string; asset_reference: string | null; name: string }> = await context.manager.query(
      `SELECT a.id, a.asset_reference, a.name
         FROM assets a
        WHERE a.tenant_id = $1
          AND (${isUuid(raw) ? 'a.id = $2::uuid OR ' : ''}
               upper(COALESCE(a.asset_reference, '')) = upper(btrim($2))
               OR lower(btrim(a.name)) = lower(btrim($2))
               OR lower(btrim(a.hostname)) = lower(btrim($2))
               OR lower(btrim(a.fqdn)) = lower(btrim($2)))
        ORDER BY lower(a.name), a.id
        LIMIT 6`,
      params,
    );
    if (rows.length === 0) throw new NotFoundException(`Asset "${raw}" not found.`);
    if (rows.length > 1) throw new BadRequestException(`Multiple assets matched "${raw}". Use an AST reference or the UUID.`);
    const row = rows[0];
    return {
      id: String(row.id),
      ref: text(row.asset_reference),
      name: String(row.name ?? ''),
      label: labelOf(row.asset_reference, row.name, raw),
    };
  }

  /**
   * The requested servers must all be deployment servers of the application in service; the
   * refusal is the link service's own message, before the preview writes anything.
   */
  async assertDeploymentServers(context: AiExecutionContextWithManager, applicationId: string, serverIds: string[]): Promise<void> {
    if (serverIds.length === 0) return;
    const deployment: DeploymentServer[] = await this.links.deploymentServersOfApplication(applicationId, {
      manager: context.manager,
      tenantId: context.tenantId,
      userId: context.userId,
    });
    const allowed = new Set(deployment.map((server) => server.asset_id));
    if (serverIds.some((id) => !allowed.has(id))) {
      throw new BadRequestException('One or more servers are not deployment servers of this application.');
    }
  }

  /** A version by its label: the row when it exists, else the version the write would create. */
  async versionReference(context: AiExecutionContextWithManager, technologyId: string, label: string): Promise<AiTechnologyVersion> {
    const raw = text(label);
    const resolved = await resolveVersionLabel(context.manager, context.tenantId, technologyId, raw, { create: false });
    if (!resolved) return { id: null, label: raw, created: true, standard_support_end: null, extended_support_end: null };
    return this.versionRow(context.manager, context.tenantId, technologyId, resolved.id);
  }

  /** Resolve the label, creating the version when missing, with its audit row and source. */
  async createVersion(
    context: AiExecutionContextWithManager,
    technologyId: string,
    label: string,
    options: { audit?: AuditSourceOptions },
  ): Promise<AiTechnologyVersion> {
    const raw = text(label);
    const resolved = await resolveVersionLabel(context.manager, context.tenantId, technologyId, raw, {
      create: true,
      audit: {
        service: this.audit,
        userId: context.userId ?? null,
        audit: options.audit,
      },
    });
    if (!resolved) throw new BadRequestException('Version not found.');
    const row = await this.versionRow(context.manager, context.tenantId, technologyId, resolved.id);
    return { ...row, created: resolved.created };
  }

  /** The version row of this technology (the id comes from the link service's resolution). */
  async versionRow(mg: EntityManager, tenantId: string, technologyId: string, versionId: string): Promise<AiTechnologyVersion> {
    const rows: Array<{ id: string; label: string; standard_support_end: string | null; extended_support_end: string | null }> = await mg.query(
      `SELECT v.id, v.label,
              to_char(v.standard_support_end, 'YYYY-MM-DD') AS standard_support_end,
              to_char(v.extended_support_end, 'YYYY-MM-DD') AS extended_support_end
         FROM technology_versions v
        WHERE v.tenant_id = $1 AND v.technology_id = $2 AND v.id = $3`,
      [tenantId, technologyId, versionId],
    );
    if (!rows[0]) throw new BadRequestException('Version not found.');
    return {
      id: String(rows[0].id),
      label: String(rows[0].label ?? ''),
      created: false,
      standard_support_end: rows[0].standard_support_end ?? null,
      extended_support_end: rows[0].extended_support_end ?? null,
    };
  }

  /** The declarations of the technology by applications, optionally of one application. */
  async applicationLinks(context: AiExecutionContextWithManager, technologyId: string, applicationId?: string): Promise<AiTechnologyLinkRow[]> {
    const params: unknown[] = [context.tenantId, technologyId];
    if (applicationId) params.push(applicationId);
    const rows: Array<{ link_id: string; subject_id: string; version_id: string | null; version_label: string | null; notes: string | null; source_ref: string | null }> = await context.manager.query(
      `SELECT l.id AS link_id, l.application_id AS subject_id, l.technology_version_id AS version_id,
              v.label AS version_label, l.notes, l.source_ref
         FROM application_technologies l
         LEFT JOIN technology_versions v ON v.tenant_id = l.tenant_id AND v.id = l.technology_version_id
        WHERE l.tenant_id = $1 AND l.technology_id = $2
          ${applicationId ? 'AND l.application_id = $3' : ''}
        ORDER BY l.application_id, v.label NULLS FIRST, l.id`,
      params,
    );
    return rows.map((row) => ({
      link_id: String(row.link_id),
      subject_id: String(row.subject_id),
      version_id: row.version_id ? String(row.version_id) : null,
      version_label: row.version_label ? String(row.version_label) : null,
      notes: row.notes ?? null,
      source_ref: row.source_ref ?? null,
    }));
  }

  /** The installations of the technology on servers, optionally of one server. */
  async assetLinks(context: AiExecutionContextWithManager, technologyId: string, assetId?: string): Promise<AiTechnologyLinkRow[]> {
    const params: unknown[] = [context.tenantId, technologyId];
    if (assetId) params.push(assetId);
    const rows: Array<{ link_id: string; subject_id: string; version_id: string | null; version_label: string | null; notes: string | null; source_ref: string | null }> = await context.manager.query(
      `SELECT l.id AS link_id, l.asset_id AS subject_id, l.technology_version_id AS version_id,
              v.label AS version_label, l.notes, l.source_ref
         FROM asset_technologies l
         LEFT JOIN technology_versions v ON v.tenant_id = l.tenant_id AND v.id = l.technology_version_id
        WHERE l.tenant_id = $1 AND l.technology_id = $2
          ${assetId ? 'AND l.asset_id = $3' : ''}
        ORDER BY l.asset_id, v.label NULLS FIRST, l.id`,
      params,
    );
    return rows.map((row) => ({
      link_id: String(row.link_id),
      subject_id: String(row.subject_id),
      version_id: row.version_id ? String(row.version_id) : null,
      version_label: row.version_label ? String(row.version_label) : null,
      notes: row.notes ?? null,
      source_ref: row.source_ref ?? null,
    }));
  }

  /** The options a link write passes to the service for one preview. */
  linkOptions(context: AiExecutionContextWithManager, preview: { id: string }): LinkOpts {
    return {
      manager: context.manager,
      tenantId: context.tenantId,
      userId: context.userId ?? null,
      audit: { source: 'ai_chat', sourceRef: preview.id },
    };
  }

  /** The applications reach of a write that names applications. */
  reach(options: AiTechnologyWriteOptions): ApplicationsReach {
    return options.applications ? { scope: options.applicationScope } : null;
  }
}
