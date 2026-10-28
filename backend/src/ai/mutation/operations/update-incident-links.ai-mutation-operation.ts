import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import { z } from 'zod';
import {
  applicationParticipantCondition,
  type ParticipationAccessScope,
} from '../../../auth/business-contributor-scope';
import { binder } from '../../../common/relations/related-objects';
import { IncidentRelationsService } from '../../../incidents/services/incident-relations.service';
import { AiMutationPreview } from '../../ai-mutation-preview.entity';
import {
  AiWriteLanguage,
  incidentLinkCardText,
  incidentLinkKindText,
  previewSummaryText,
  quoted,
  writeActionText,
} from '../../ai-write-texts';
import { AiExecutionContextWithManager } from '../../ai.types';
import { buildAiMutationAudit } from '../ai-mutation-audit.util';
import {
  AiIncidentMutationSupportService,
  AiIncidentWriteOptions,
} from '../ai-incident-mutation-support.service';
import {
  AiMutationOperation,
  AiMutationPreviewPresentation,
  AiPreparedMutationPreview,
} from '../ai-mutation-operation.types';

type LinkKind = 'assets' | 'applications' | 'technologies';
const LINK_KINDS: LinkKind[] = ['assets', 'applications', 'technologies'];

type LinkGroupInput = { add?: string[]; remove?: string[] };
type UpdateIncidentLinksInput = {
  ref: string;
  assets?: LinkGroupInput;
  applications?: LinkGroupInput;
  technologies?: LinkGroupInput;
};

type StoredLinkTarget = { id: string; ref: string | null; name: string; label: string };
type StoredLinkGroup = {
  add: StoredLinkTarget[];
  remove: StoredLinkTarget[];
  already: StoredLinkTarget[];
  absent: StoredLinkTarget[];
};
type StoredLinkChanges = Record<LinkKind, StoredLinkGroup>;
type StoredAppliedLinks = Record<LinkKind, { added: StoredLinkTarget[]; removed: StoredLinkTarget[] }>;

const LINK_GROUP_SCHEMA = z.object({
  add: z.array(z.string()).optional()
    .describe('Targets to link: a reference (AST-n, APP-n, TEC-n), an exact name, or the UUID; an asset also answers to its hostname or fqdn.'),
  remove: z.array(z.string()).optional()
    .describe('Targets to unlink, same forms as `add`.'),
});

const DESCRIPTION_BY_KIND: Record<LinkKind, { subject: string; plural: string }> = {
  assets: { subject: 'Asset', plural: 'assets' },
  applications: { subject: 'Application', plural: 'applications' },
  technologies: { subject: 'Technology', plural: 'technologies' },
};

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function uniqueRefs(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)));
}

function labelOf(ref: string | null, name: string | null, fallback: string): string {
  return [ref, name].map((part) => String(part ?? '').trim()).filter(Boolean).join(' - ') || fallback;
}

function buildTarget(preview: AiMutationPreview): AiMutationPreviewPresentation['target'] {
  const current = preview.current_values ?? {};
  return {
    entity_type: 'incidents',
    entity_id: preview.target_entity_id ?? null,
    ref: typeof current.target_ref === 'string' ? current.target_ref : null,
    title: typeof current.target_title === 'string' ? current.target_title : null,
  };
}

function emptyChanges(): StoredLinkChanges {
  return {
    assets: { add: [], remove: [], already: [], absent: [] },
    applications: { add: [], remove: [], already: [], absent: [] },
    technologies: { add: [], remove: [], already: [], absent: [] },
  };
}

function coerceChanges(value: unknown): StoredLinkChanges {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const changes = emptyChanges();
  for (const kind of LINK_KINDS) {
    const group = raw[kind] && typeof raw[kind] === 'object' ? raw[kind] as Record<string, unknown> : {};
    for (const key of ['add', 'remove', 'already', 'absent'] as const) {
      const items = Array.isArray(group[key]) ? group[key] as Array<Record<string, unknown>> : [];
      changes[kind][key] = items
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          id: String(item.id ?? ''),
          ref: textOrNull(item.ref),
          name: String(item.name ?? ''),
          label: String(item.label ?? ''),
        }))
        .filter((item) => item.id);
    }
  }
  return changes;
}

function coerceApplied(value: unknown): StoredAppliedLinks | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const applied: StoredAppliedLinks = {
    assets: { added: [], removed: [] },
    applications: { added: [], removed: [] },
    technologies: { added: [], removed: [] },
  };
  let any = false;
  for (const kind of LINK_KINDS) {
    const group = raw[kind] && typeof raw[kind] === 'object' ? raw[kind] as Record<string, unknown> : {};
    for (const key of ['added', 'removed'] as const) {
      const items = Array.isArray(group[key]) ? group[key] as Array<Record<string, unknown>> : [];
      applied[kind][key] = items
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          id: String(item.id ?? ''),
          ref: textOrNull(item.ref),
          name: String(item.name ?? ''),
          label: String(item.label ?? ''),
        }))
        .filter((item) => item.id);
      if (applied[kind][key].length > 0) any = true;
    }
  }
  return any ? applied : null;
}

/**
 * Link and unlink assets, applications and technologies on one incident, one `setLink` call per
 * link so the incident services keep the closure lock, the `link_change` journal entry, the audit
 * row, the idempotence and the Business Contributor participation scope. A link that is already
 * there (or already absent) writes nothing and is not an error, but a preview that would change
 * no link at all is refused with what it found. The preview is reversible: undo reverses the
 * links that actually changed, while the record is open.
 */
@Injectable()
export class UpdateIncidentLinksAiMutationOperation implements AiMutationOperation<UpdateIncidentLinksInput> {
  readonly toolName = 'update_incident_links' as const;
  readonly description = 'Create a preview to link or unlink assets, applications and technologies on one incident. Requires explicit user approval before execution.';
  readonly inputSchema = z.object({
    ref: z.string().trim().min(1)
      .describe('Incident reference: an INC-n reference, the incident UUID, or its exact title.'),
    assets: LINK_GROUP_SCHEMA.optional(),
    applications: LINK_GROUP_SCHEMA.optional(),
    technologies: LINK_GROUP_SCHEMA.optional(),
  }).refine((value) => LINK_KINDS.some((kind) => uniqueRefs(value[kind]?.add).length > 0 || uniqueRefs(value[kind]?.remove).length > 0), {
    message: 'At least one link to add or remove is required.',
  });
  readonly inputSummary = {
    ref: 'Incident reference: INC-n, the incident UUID, or its exact title.',
    assets: 'Assets to link (`add`) or unlink (`remove`), by AST-n reference, exact name, hostname, fqdn or UUID.',
    applications: 'Applications to link or unlink, by APP-n reference, exact name or UUID.',
    technologies: 'Technologies to link or unlink, by TEC-n reference, exact name or UUID.',
  };
  readonly businessResource = 'incidents';
  readonly writePreview = {
    entity_type: 'incidents',
    fields: ['linked_assets', 'linked_applications', 'linked_technologies'],
    reversible: true,
    prompt_hint: 'For the links of an incident, use `update_incident_links` with an INC reference and, per kind (`assets`, `applications`, `technologies`), the exact references or names to `add` and `remove`. When the request starts from the other side ("link APP-2 to INC-3", "add incident INC-3 to asset AST-12"), keep the incident in `ref` and put the record in that kind\'s `add` or `remove`. Assets also answer to their hostname or fqdn. A link already present, or already absent, writes nothing. A Business Contributor links only the applications they take part in; another reads as not found. A closed or cancelled incident is refused. Undo reverses the links that changed while the incident stays open.',
  };

  constructor(
    private readonly support: AiIncidentMutationSupportService,
    private readonly relations: IncidentRelationsService,
  ) {}

  resolveWriteFamily(): string {
    return 'incidents';
  }

  async prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: UpdateIncidentLinksInput,
  ): Promise<AiPreparedMutationPreview> {
    const incident = await this.support.resolveIncident(context, input.ref);
    this.support.assertEditable(incident);
    const options = await this.support.writeOptions(context);
    const changes = await this.prepareChanges(context, incident.id, input, options);
    // A preview that would write nothing is refused at preparation, with what it found: an
    // approval of an empty card promises a change the person would never see.
    const linked = LINK_KINDS.flatMap((kind) => [
      ...changes[kind].already.map((target) => `${target.label} is already linked`),
      ...changes[kind].absent.map((target) => `${target.label} is not linked`),
    ]);
    if (!LINK_KINDS.some((kind) => changes[kind].add.length > 0 || changes[kind].remove.length > 0)) {
      throw new BadRequestException(`Nothing to change: ${linked.join('; ')}.`);
    }
    return {
      targetEntityType: 'incidents',
      targetEntityId: incident.id,
      mutationInput: {
        incident_ref: incident.ref,
        incident_label: incident.label,
        changes,
      },
      currentValues: {
        target_ref: incident.ref,
        target_title: incident.label,
        status: incident.status,
      },
    };
  }

  presentPreview(preview: AiMutationPreview, language: AiWriteLanguage = 'en'): AiMutationPreviewPresentation {
    const current = preview.current_values ?? {};
    const mutation = preview.mutation_input ?? {};
    const ref = typeof current.target_ref === 'string' ? current.target_ref : 'INC';
    const label = typeof current.target_title === 'string' && current.target_title.trim()
      ? current.target_title
      : ref;
    const changes = coerceChanges(mutation.changes);

    let summary = `Preview ${preview.id} ${preview.status}.`;
    switch (preview.status) {
      case 'pending':
        summary = `Update the links of ${label}.`;
        break;
      case 'executed':
        summary = `Links updated on ${label}.`;
        break;
      case 'rejected':
        summary = `Links preview for ${label} was rejected.`;
        break;
      case 'expired':
        summary = `Links preview for ${label} expired before approval.`;
        break;
      case 'failed':
        summary = preview.error_message || `Links preview for ${label} failed.`;
        break;
    }

    if (language !== 'en') {
      summary = previewSummaryText(
        language,
        preview.status,
        writeActionText.updateIncidentLinks(language, quoted(language, label)),
        { errorMessage: preview.error_message },
      );
    }

    const cardChanges: Record<string, AiMutationPreviewPresentation['changes'][string]> = {};
    for (const kind of LINK_KINDS) {
      const group = changes[kind];
      if ([...group.add, ...group.remove, ...group.already, ...group.absent].length === 0) continue;
      cardChanges[`linked_${kind}`] = {
        label: incidentLinkKindText(language, kind),
        from: null,
        to: incidentLinkCardText(language, {
          add: group.add.map((item) => item.label),
          remove: group.remove.map((item) => item.label),
          already: group.already.map((item) => item.label),
          absent: group.absent.map((item) => item.label),
        }),
        format: 'markdown',
      };
    }

    return {
      target: buildTarget(preview),
      changes: cardChanges,
      summary,
    };
  }

  async executePreview(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
  ): Promise<void> {
    if (!preview.target_entity_id) throw new BadRequestException('Preview is missing the incident.');
    const incident = await this.support.resolveIncident(context, preview.target_entity_id);
    this.support.assertEditable(incident);
    const mutation = preview.mutation_input ?? {};
    const changes = coerceChanges(mutation.changes);
    const options = await this.support.writeOptions(context);
    const applied: StoredAppliedLinks = {
      assets: { added: [], removed: [] },
      applications: { added: [], removed: [] },
      technologies: { added: [], removed: [] },
    };

    for (const kind of LINK_KINDS) {
      const group = changes[kind];
      if (group.add.length === 0 && group.remove.length === 0) continue;
      // The module read is checked again when the preview runs, as the route does.
      await this.support.assertTargetRead(context, kind);
      const current = await this.readCurrentLinks(context, incident.id, kind, options);
      const currentIds = new Set(current.map((item) => item.id));
      // A link the preview promised changed elsewhere: refuse rather than write a different set.
      for (const target of [...group.add, ...group.remove]) {
        const expectedPresent = group.remove.some((item) => item.id === target.id);
        if (currentIds.has(target.id) !== expectedPresent) {
          throw new ConflictException(`Links on ${incident.ref} changed after the preview was created.`);
        }
      }
      for (const target of group.add) {
        const result = await this.relations.setLink(
          kind,
          incident.id,
          target.id,
          true,
          context.userId,
          this.serviceOptions(options, preview),
        );
        if (result.changed) applied[kind].added.push(target);
      }
      for (const target of group.remove) {
        const result = await this.relations.setLink(
          kind,
          incident.id,
          target.id,
          false,
          context.userId,
          this.serviceOptions(options, preview),
        );
        if (result.changed) applied[kind].removed.push(target);
      }
    }

    preview.current_values = {
      ...(preview.current_values ?? {}),
      applied,
    };
  }

  async prepareReversePreview(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
  ): Promise<AiPreparedMutationPreview> {
    const applied = coerceApplied(preview.current_values?.applied);
    if (!applied) throw new BadRequestException('This preview changed no link.');
    if (!preview.target_entity_id) throw new BadRequestException('Original preview is missing the incident.');
    const incident = await this.support.resolveIncident(context, preview.target_entity_id);
    this.support.assertEditable(incident);
    const options = await this.support.writeOptions(context);
    const changes = emptyChanges();

    for (const kind of LINK_KINDS) {
      const { added, removed } = applied[kind];
      if (added.length === 0 && removed.length === 0) continue;
      await this.support.assertTargetRead(context, kind);
      const current = await this.readCurrentLinks(context, incident.id, kind, options);
      const currentIds = new Set(current.map((item) => item.id));
      // Exactly the links this preview changed can be reversed; a link changed since then is drift.
      for (const target of added) {
        if (!currentIds.has(target.id)) {
          throw new ConflictException(`Links on ${incident.ref} changed after the preview was created.`);
        }
      }
      for (const target of removed) {
        if (currentIds.has(target.id)) {
          throw new ConflictException(`Links on ${incident.ref} changed after the preview was created.`);
        }
      }
      changes[kind] = {
        add: removed,
        remove: added,
        already: [],
        absent: [],
      };
    }

    if (LINK_KINDS.every((kind) => changes[kind].add.length === 0 && changes[kind].remove.length === 0)) {
      throw new BadRequestException('This preview changed no link.');
    }
    return {
      targetEntityType: 'incidents',
      targetEntityId: incident.id,
      mutationInput: {
        incident_ref: incident.ref,
        incident_label: incident.label,
        changes,
        reverse_of: preview.id,
      },
      currentValues: {
        target_ref: incident.ref,
        target_title: incident.label,
        status: incident.status,
      },
    };
  }

  private serviceOptions(options: AiIncidentWriteOptions, preview: AiMutationPreview) {
    return {
      manager: options.manager,
      tenantId: options.tenantId,
      viewer: options.viewer,
      technologies: options.technologies,
      applications: options.applications,
      applicationScope: options.applicationScope,
      audit: buildAiMutationAudit(preview),
    };
  }

  /** Resolve every requested target and compare it with what is already linked, before any preview. */
  private async prepareChanges(
    context: AiExecutionContextWithManager,
    incidentId: string,
    input: UpdateIncidentLinksInput,
    options: AiIncidentWriteOptions,
  ): Promise<StoredLinkChanges> {
    const changes = emptyChanges();
    for (const kind of LINK_KINDS) {
      const addRefs = uniqueRefs(input[kind]?.add);
      const removeRefs = uniqueRefs(input[kind]?.remove);
      if (addRefs.length === 0 && removeRefs.length === 0) continue;
      await this.support.assertTargetRead(context, kind);
      const addTargets: StoredLinkTarget[] = [];
      for (const ref of addRefs) addTargets.push(await this.resolveTarget(context, kind, ref, options));
      const removeTargets: StoredLinkTarget[] = [];
      for (const ref of removeRefs) removeTargets.push(await this.resolveTarget(context, kind, ref, options));
      const addIds = new Set(addTargets.map((target) => target.id));
      const conflict = removeTargets.find((target) => addIds.has(target.id));
      if (conflict) {
        throw new BadRequestException(`"${conflict.label}" cannot be both added and removed on the same preview.`);
      }
      const current = await this.readCurrentLinks(context, incidentId, kind, options);
      const currentIds = new Set(current.map((item) => item.id));
      for (const target of addTargets) {
        (currentIds.has(target.id) ? changes[kind].already : changes[kind].add).push(target);
      }
      for (const target of removeTargets) {
        (currentIds.has(target.id) ? changes[kind].remove : changes[kind].absent).push(target);
      }
    }
    return changes;
  }

  /** The target's row, resolved by uuid, business reference or exact name (hostname and fqdn for an asset). */
  private async resolveTarget(
    context: AiExecutionContextWithManager,
    kind: LinkKind,
    input: string,
    options: AiIncidentWriteOptions,
  ): Promise<StoredLinkTarget> {
    const uuid = isUuid(input);
    const params: unknown[] = [context.tenantId];
    if (uuid) params.push(input);
    params.push(input);
    const nameRef = `$${params.length}`;
    const uuidSql = uuid ? 'target.id = $2 OR ' : '';
    const aliases = kind === 'assets'
      ? [
        'COALESCE(target.asset_reference, \'\')',
        'COALESCE(target.name, \'\')',
        'COALESCE(target.hostname, \'\')',
        'COALESCE(target.fqdn, \'\')',
      ]
      : kind === 'applications'
        ? ['COALESCE(target.sequential_id, \'\')', 'COALESCE(target.name, \'\')']
        : ['(\'TEC-\' || target.item_number)', 'COALESCE(target.name, \'\')'];
    const matches = aliases.map((alias) => `LOWER(BTRIM(${alias})) = LOWER(${nameRef}::text)`).join('\n          OR ');
    const reference = kind === 'assets'
      ? 'target.asset_reference'
      : kind === 'applications'
        ? 'target.sequential_id'
        : `'TEC-' || target.item_number`;
    const scope = kind === 'applications' && options.applicationScope
      ? ` AND ${applicationParticipantCondition('target', binder(params)(options.applicationScope.userId))}`
      : '';
    const table = kind === 'assets' ? 'assets' : kind === 'applications' ? 'applications' : 'technologies';
    const rows: Array<{ id: string; reference: string | null; name: string }> = await context.manager.query(
      `SELECT target.id, ${reference} AS reference, target.name
         FROM ${table} target
        WHERE target.tenant_id = $1
          AND (${uuidSql}${matches})
          ${scope}
        ORDER BY LOWER(COALESCE(target.name, '')), target.id
        LIMIT 6`,
      params,
    );
    if (rows.length === 0) {
      throw new NotFoundException(`${DESCRIPTION_BY_KIND[kind].subject} "${input}" not found.`);
    }
    if (rows.length > 1) {
      throw new BadRequestException(`Multiple ${DESCRIPTION_BY_KIND[kind].plural} matched "${input}". Use a reference or the UUID.`);
    }
    const row = rows[0];
    const ref = textOrNull(row.reference);
    return {
      id: String(row.id),
      ref,
      name: String(row.name ?? ''),
      label: labelOf(ref, row.name, input),
    };
  }

  /**
   * The links already on the incident, in the same scope as the Relations tab: applications are
   * narrowed to a Business Contributor's participation, so a hidden link never looks present.
   */
  private async readCurrentLinks(
    context: AiExecutionContextWithManager,
    incidentId: string,
    kind: LinkKind,
    options: AiIncidentWriteOptions,
  ): Promise<StoredLinkTarget[]> {
    const params: unknown[] = [context.tenantId, incidentId];
    const scope = kind === 'applications' && options.applicationScope
      ? ` AND ${applicationParticipantCondition('target', binder(params)(options.applicationScope.userId))}`
      : '';
    const reference = kind === 'assets'
      ? 'target.asset_reference'
      : kind === 'applications'
        ? 'target.sequential_id'
        : `'TEC-' || target.item_number`;
    const table = kind === 'assets' ? 'assets' : kind === 'applications' ? 'applications' : 'technologies';
    const linkTable = kind === 'assets' ? 'incident_assets' : kind === 'applications' ? 'incident_applications' : 'incident_technologies';
    const linkColumn = kind === 'assets' ? 'asset_id' : kind === 'applications' ? 'application_id' : 'technology_id';
    const rows: Array<{ id: string; reference: string | null; name: string }> = await context.manager.query(
      `SELECT target.id, ${reference} AS reference, target.name
         FROM ${linkTable} link
         JOIN ${table} target ON target.id = link.${linkColumn} AND target.tenant_id = link.tenant_id
        WHERE link.tenant_id = $1 AND link.incident_id = $2
          ${scope}
        ORDER BY LOWER(COALESCE(target.name, '')), target.id`,
      params,
    );
    return rows.map((row) => {
      const ref = textOrNull(row.reference);
      return {
        id: String(row.id),
        ref,
        name: String(row.name ?? ''),
        label: labelOf(ref, row.name, String(row.id)),
      };
    });
  }
}
