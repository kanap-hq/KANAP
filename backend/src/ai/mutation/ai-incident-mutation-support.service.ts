import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { validate as isUuid } from 'uuid';
import type { ParticipationAccessScope } from '../../auth/business-contributor-scope';
import {
  INCIDENT_LOCKED_MESSAGE,
  IncidentViewer,
  incidentVisibilitySql,
  isFrozenIncidentStatus,
} from '../../incidents/incident-visibility';
import { AiExecutionContextWithManager } from '../ai.types';
import { AiPolicyService } from '../ai-policy.service';
import { parseItemNumber } from '../../common/parse-item-number';
import { resolveAiIncidentViewer, resolveAiParticipationAccessScope } from '../query/ai-query-scope.util';

/** One incident as the Plaid incident writes read it, with the viewer's confidentiality applied. */
export type AiIncidentSnapshot = {
  id: string;
  ref: string;
  title: string;
  label: string;
  status: string;
  confidential: boolean;
  /** The reporter as stored; null stays null, as on a change, where only a creation defaults it. */
  reporterUserId: string | null;
  ownerUserId: string | null;
};

/** The service options an incident write passes to the incident services. */
export type AiIncidentWriteOptions = {
  manager: EntityManager;
  tenantId: string;
  viewer: IncidentViewer;
  /** The caller reads the infrastructure (assets and technologies). */
  technologies: boolean;
  /** The caller reads applications, narrowed to their participation when they are a Business Contributor. */
  applications: boolean;
  applicationScope?: ParticipationAccessScope;
};

/**
 * Shared resolution for the incident writes that are not the business-record family: the journal
 * note and the links. A reference is a uuid, an `INC-n` or an exact title, resolved with the
 * caller's confidentiality, so a hidden incident answers "not found" exactly as the screen does.
 */
@Injectable()
export class AiIncidentMutationSupportService {
  constructor(private readonly policy: AiPolicyService) {}

  async resolveIncident(
    context: AiExecutionContextWithManager,
    reference: string | null | undefined,
  ): Promise<AiIncidentSnapshot> {
    const raw = String(reference ?? '').trim();
    if (!raw) throw new NotFoundException('No incidents found matching "".');
    const viewer = await resolveAiIncidentViewer(context);
    const uuid = isUuid(raw);
    const itemNumber = parseItemNumber(raw.match(/^INC-(\d+)$/i)?.[1]);
    const params: unknown[] = [context.tenantId, raw, itemNumber];
    const visibility = incidentVisibilitySql('i', viewer, params);
    const rows: Array<{
      id: string;
      item_number: number;
      title: string;
      status: string;
      confidential: boolean;
      reporter_user_id: string | null;
      owner_user_id: string | null;
    }> = await context.manager.query(
      `SELECT i.id, i.item_number, i.title, i.status, i.confidential,
              i.reporter_user_id, i.owner_user_id
         FROM incidents i
        WHERE i.tenant_id = $1
          AND (${uuid ? 'i.id = $2 OR ' : ''}(($3::int IS NOT NULL AND i.item_number = $3::int) OR LOWER(i.title) = LOWER($2::text)))
          ${visibility}
        ORDER BY i.item_number
        LIMIT 6`,
      params,
    );
    if (rows.length === 0) throw new NotFoundException(`No incidents found matching "${raw}".`);
    if (rows.length > 1) throw new BadRequestException(`Multiple incidents matched "${raw}". Use an INC reference.`);
    const row = rows[0];
    const ref = `INC-${row.item_number}`;
    const title = String(row.title ?? '').trim();
    return {
      id: String(row.id),
      ref,
      title,
      // The resolution already applies the visibility: the card names the title, as every card.
      label: title ? `${ref} - ${title}` : ref,
      status: String(row.status ?? ''),
      confidential: row.confidential === true,
      reporterUserId: row.reporter_user_id ? String(row.reporter_user_id) : null,
      ownerUserId: row.owner_user_id ? String(row.owner_user_id) : null,
    };
  }

  /** A closed or cancelled incident refuses every write until an administrator reopens it. */
  assertEditable(incident: AiIncidentSnapshot): void {
    if (isFrozenIncidentStatus(incident.status)) {
      throw new ForbiddenException(INCIDENT_LOCKED_MESSAGE);
    }
  }

  /** The service options of an incident write: the viewer, the module reads and the application scope. */
  async writeOptions(context: AiExecutionContextWithManager): Promise<AiIncidentWriteOptions> {
    const viewer = await resolveAiIncidentViewer(context);
    const technologies = await this.policy.canReadEntityType(context, 'assets', context.manager);
    const applications = await this.policy.canReadEntityType(context, 'applications', context.manager);
    return {
      manager: context.manager,
      tenantId: context.tenantId,
      viewer,
      technologies,
      applications,
      applicationScope: applications
        ? await resolveAiParticipationAccessScope(context, 'applications')
        : undefined,
    };
  }

  /**
   * The read of the module a link names, as the Relations tab requires it: infrastructure for
   * assets and technologies, applications for applications. Refused before the preview and again
   * when it runs, so the preview never promises a link the person cannot see.
   */
  async assertTargetRead(
    context: AiExecutionContextWithManager,
    kind: 'assets' | 'applications' | 'technologies',
  ): Promise<void> {
    await this.policy.assertBusinessPermission(
      context,
      kind === 'applications' ? 'applications' : 'infrastructure',
      'reader',
      context.manager,
    );
  }
}
