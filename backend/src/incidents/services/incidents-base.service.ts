import { BadRequestException } from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';
import type { ParticipationAccessScope } from '../../auth/business-contributor-scope';
import type { AuditSourceOptions } from '../../audit/audit.service';
import { Incident } from '../incident.entity';
import { incidentNotFound } from '../../common/resolve-item-id';
import { IncidentChangedFields, IncidentEntry, IncidentEntryKind } from '../incident-entry.entity';
import {
  INCIDENT_LOCKED_MESSAGE,
  incidentLocked,
  IncidentViewer,
  incidentVisibleToViewer,
  isFrozenIncidentStatus,
} from '../incident-visibility';

/**
 * Common options for service methods.
 */
export interface ServiceOpts {
  manager?: EntityManager;
  tenantId?: string;
  viewer?: IncidentViewer;
  /**
   * The caller reads the infrastructure. The Relations tab then lists assets and technologies,
   * and the detail counts them (`counts.assets`, `counts.technologies`). The list search matches
   * the names and references of the linked assets and technologies.
   */
  technologies?: boolean;
  /**
   * The caller reads applications. The Relations tab then lists them, and the detail counts them
   * (`counts.applications`), inside `applicationScope` when the caller is a Business Contributor.
   */
  applications?: boolean;
  applicationScope?: ParticipationAccessScope;
  /**
   * The caller reads the tasks module. The complete record (`IncidentRecordService.load`) then
   * lists the incident's tasks; without it, the tasks section is absent from the record.
   */
  tasks?: boolean;
  /**
   * The audit entry's source: the screen leaves it out (`user`), Plaid names its preview
   * (`{ source: 'ai_chat', sourceRef: preview.id }`), as `TasksUnifiedService` does.
   */
  audit?: AuditSourceOptions;
}

/** Re-exported for the existing import sites; the text lives in `incident-visibility.ts`. */
export { INCIDENT_LOCKED_MESSAGE };

/** "First Last" for a `users` alias; falls back to the email when both names are empty. */
export function userNameSql(alias: string): string {
  return `COALESCE(NULLIF(TRIM(CONCAT(${alias}.first_name, ' ', ${alias}.last_name)), ''), ${alias}.email)`;
}

export function incidentRef(itemNumber: number): string {
  return `INC-${itemNumber}`;
}

/**
 * Base class with shared utilities for incident services.
 */
export abstract class IncidentsBaseService {
  constructor(protected readonly incidentRepo: Repository<Incident>) {}

  protected getManager(opts?: ServiceOpts): EntityManager {
    return opts?.manager ?? this.incidentRepo.manager;
  }

  protected ensureTenantId(tenantId?: string): string {
    const normalized = String(tenantId || '').trim();
    if (!normalized) {
      throw new BadRequestException('Tenant context is required');
    }
    return normalized;
  }

  async ensureIncident(
    id: string,
    manager: EntityManager,
    tenantId: string,
    viewer?: IncidentViewer,
  ): Promise<Incident> {
    const incident = await manager.getRepository(Incident).findOne({ where: { id, tenant_id: tenantId } });
    if (!incident || !incidentVisibleToViewer(incident, viewer)) {
      throw incidentNotFound();
    }
    return incident;
  }

  /**
   * Closure lock: closed and cancelled incidents refuse every write until reopened.
   */
  protected assertEditable(incident: Incident): void {
    if (isFrozenIncidentStatus(incident.status)) {
      throw incidentLocked();
    }
  }

  /**
   * Load an incident and refuse when it is locked. Used by every write path.
   */
  async ensureEditable(id: string, opts?: ServiceOpts): Promise<Incident> {
    const incident = await this.ensureIncident(
      id,
      this.getManager(opts),
      this.ensureTenantId(opts?.tenantId),
      opts?.viewer,
    );
    this.assertEditable(incident);
    return incident;
  }

  /**
   * Append a timeline entry. `created_at` is always server time.
   */
  protected addEntry(
    manager: EntityManager,
    incident: Incident,
    entry: {
      kind: IncidentEntryKind;
      content?: string | null;
      changed_fields?: IncidentChangedFields | null;
      occurred_at?: Date;
      author_id: string | null;
    },
  ): Promise<IncidentEntry> {
    const repo = manager.getRepository(IncidentEntry);
    return repo.save(repo.create({
      tenant_id: incident.tenant_id,
      incident_id: incident.id,
      kind: entry.kind,
      content: entry.content ?? null,
      changed_fields: entry.changed_fields ?? null,
      occurred_at: entry.occurred_at ?? new Date(),
      author_id: entry.author_id,
    }));
  }
}
