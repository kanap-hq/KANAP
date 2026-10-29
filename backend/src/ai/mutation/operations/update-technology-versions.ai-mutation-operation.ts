import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { TechnologiesService } from '../../../technologies/technologies.service';
import { isCalendarDay } from '../../../technologies/technology-rows';
import { AiMutationPreview } from '../../ai-mutation-preview.entity';
import {
  AiWriteLanguage,
  previewSummaryText,
  quoted,
  technologyVersionEditCardText,
  writeActionText,
  type TechnologyVersionEditUpdate,
} from '../../ai-write-texts';
import { AiExecutionContextWithManager } from '../../ai.types';
import { buildAiMutationAudit } from '../ai-mutation-audit.util';
import { AiTechnologyMutationSupportService, AiTechnologyTarget } from '../ai-technology-mutation-support.service';
import { AiMutationOperation, AiMutationPreviewPresentation, AiPreparedMutationPreview } from '../ai-mutation-operation.types';

const VERSION_ADD = z.object({
  label: z.string().trim().min(1).max(100)
    .describe('Version label, as the screen writes it (for example 17 or 16.4).'),
  standard_support_end: z.union([z.string(), z.null()]).optional()
    .describe('End of standard support, YYYY-MM-DD; null or absent for no date.'),
  extended_support_end: z.union([z.string(), z.null()]).optional()
    .describe('End of extended support, YYYY-MM-DD, on or after the standard end; null or absent for no date.'),
  notes: z.string().max(20000).nullable().optional()
    .describe('Notes, up to 20000 characters; null clears them.'),
}).strict();

const VERSION_UPDATE = z.object({
  version: z.string().trim().min(1).max(100)
    .describe('The current label of the version to change.'),
  label: z.string().trim().min(1).max(100).optional()
    .describe('The new label, when the version is renamed.'),
  standard_support_end: z.union([z.string(), z.null()]).optional()
    .describe('End of standard support, YYYY-MM-DD; null clears it; absent leaves it.'),
  extended_support_end: z.union([z.string(), z.null()]).optional()
    .describe('End of extended support, YYYY-MM-DD, on or after the standard end; null clears it; absent leaves it.'),
  notes: z.string().max(20000).nullable().optional()
    .describe('Notes, up to 20000 characters; null clears them; absent leaves them.'),
}).strict();

export const UpdateTechnologyVersionsInputSchema = z.object({
  technology: z.string().trim().min(1)
    .describe('Technology whose versions change: a TEC-n reference, its UUID or its exact name.'),
  add: z.array(VERSION_ADD).max(100).optional()
    .describe('Versions to create, each with its label and optional support dates and notes.'),
  update: z.array(VERSION_UPDATE).max(100).optional()
    .describe('Versions to change, each named by its current label, with the fields that change.'),
}).strict().refine((value) => (value.add?.length ?? 0) + (value.update?.length ?? 0) > 0, {
  message: 'At least one version to add or update is required.',
});

type UpdateTechnologyVersionsInput = z.infer<typeof UpdateTechnologyVersionsInputSchema>;

type VersionRow = {
  id: string;
  label: string;
  standard_support_end: string | null;
  extended_support_end: string | null;
  notes: string | null;
  catalog_key: string | null;
};
type VersionAdd = { label: string; standard_support_end: string | null; extended_support_end: string | null; notes: string | null };
type VersionUpdate = { id: string; before: VersionRow; next: Record<string, unknown> };
type StoredVersions = { add: VersionAdd[]; update: VersionUpdate[] };
type Applied = {
  created: Array<{ id: string; label: string }>;
  updated: Array<{ id: string; before: VersionRow; after: VersionRow }>;
};

function trimmed(value: unknown): string {
  return String(value ?? '').trim();
}

/** A day as the service takes it, or null to clear it; the refusal names the field. */
function dayOf(value: unknown, field: string): string | null {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const text = String(value).trim().slice(0, 10);
  if (!isCalendarDay(text)) {
    throw new BadRequestException(`${field} must be a date (YYYY-MM-DD).`);
  }
  return text;
}

/** A plan step reaches `prepareCreatePreview` without the Zod schema: the keys are checked here too. */
function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[], toolName: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) {
    throw new BadRequestException(`Unknown field "${unknown[0]}" for ${toolName}. Allowed: ${allowed.join(', ')}.`);
  }
}

const VERSION_UNSUPPORTED_MESSAGES: Record<string, string> = {
  delete: 'Deleting a version is done in the technology screen, on the Overview tab, not here.',
  cpe_version: 'Plaid does not write cpe_version or build_prefixes: the vulnerability matching owns them.',
  build_prefixes: 'Plaid does not write cpe_version or build_prefixes: the vulnerability matching owns them.',
  vulnerability_alerts: "A version's vulnerability alerts are set with set_technology_vulnerability_alerts, not here.",
};

function assertVersionKeys(value: unknown, allowed: readonly string[], toolName: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException(`Every entry of ${toolName} must be an object.`);
  }
  const entry = value as Record<string, unknown>;
  for (const key of Object.keys(entry)) {
    const message = VERSION_UNSUPPORTED_MESSAGES[key];
    if (message) throw new BadRequestException(message);
  }
  assertKnownKeys(entry, allowed, toolName);
  return entry;
}

function notesOf(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value);
  if (text.length > 20000) throw new BadRequestException('Notes must be 20000 characters or fewer.');
  return text.trim() || null;
}

function versionKey(label: string): string {
  return trimmed(label).toLowerCase();
}

function endOf(row: VersionRow | VersionAdd | Record<string, unknown>): string | null {
  const extended = row.extended_support_end;
  const standard = row.standard_support_end;
  return typeof extended === 'string' && extended ? extended : typeof standard === 'string' && standard ? standard : null;
}

function assertConsistent(standard: string | null, extended: string | null): void {
  if (standard && extended && extended < standard) {
    throw new BadRequestException('The extended support cannot end before the standard support.');
  }
}

function versionRow(row: Record<string, unknown>): VersionRow {
  return {
    id: String(row.id),
    label: String(row.label ?? ''),
    standard_support_end: row.standard_support_end ? String(row.standard_support_end) : null,
    extended_support_end: row.extended_support_end ? String(row.extended_support_end) : null,
    notes: row.notes == null ? null : String(row.notes),
    catalog_key: row.catalog_key ? String(row.catalog_key) : null,
  };
}

function sameRow(a: VersionRow, b: VersionRow): boolean {
  return a.label === b.label
    && (a.standard_support_end ?? null) === (b.standard_support_end ?? null)
    && (a.extended_support_end ?? null) === (b.extended_support_end ?? null)
    && (a.notes ?? null) === (b.notes ?? null);
}

/** The versions of a technology, as the preview compares them. */
@Injectable()
export class UpdateTechnologyVersionsAiMutationOperation implements AiMutationOperation<UpdateTechnologyVersionsInput> {
  readonly toolName = 'update_technology_versions' as const;
  readonly description = 'Create a preview to add versions of a technology and to change their label, standard or extended support dates and notes. Requires explicit user approval before execution. Deleting a version stays in the technology screen.';
  readonly inputSchema = UpdateTechnologyVersionsInputSchema;
  readonly inputSummary = {
    technology: 'Technology whose versions change: TEC-n, the UUID, or its exact name.',
    add: 'Versions to create, each with `label` and optional `standard_support_end`, `extended_support_end` (YYYY-MM-DD) and `notes`.',
    update: 'Versions to change, each named by its current `version` label, with `label`, dates or `notes`; a date or notes at null clears it.',
  };
  readonly businessResource = 'infrastructure';
  readonly writePreview = {
    entity_type: 'technologies',
    fields: ['technology_versions'],
    reversible: true,
    prompt_hint: 'For the versions of a technology, use `update_technology_versions` with the technology (TEC-n, UUID or exact name), the versions to `add` with their dates, and the versions to `update` by their current label. A date is YYYY-MM-DD and null clears it; the extended support cannot end before the standard support. It never writes `cpe_version`, `build_prefixes` or a version\'s vulnerability alert setting. Deleting a version is done in the technology screen (Overview tab), not here. Undo restores the changed versions; a version added on the way stays.',
  };

  constructor(
    private readonly support: AiTechnologyMutationSupportService,
    private readonly technologies: TechnologiesService,
  ) {}

  resolveWriteFamily(): string {
    return 'technologies';
  }

  async prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: UpdateTechnologyVersionsInput,
  ): Promise<AiPreparedMutationPreview> {
    const request = this.normalizeRequest(input);
    const technology = await this.support.resolveTechnology(context, request.technology);
    const live = await this.readVersions(context, technology.id);
    const versions = this.normalizeChanges(request, live);
    return {
      targetEntityType: 'technologies',
      targetEntityId: technology.id,
      mutationInput: {
        technology_ref: technology.ref,
        technology_name: technology.name,
        technology_label: technology.label,
        versions,
      },
      currentValues: {
        target_ref: technology.ref,
        target_title: technology.label,
      },
    };
  }

  presentPreview(preview: AiMutationPreview, language: AiWriteLanguage = 'en'): AiMutationPreviewPresentation {
    const current = preview.current_values ?? {};
    const mutation = preview.mutation_input ?? {};
    const ref = typeof current.target_ref === 'string' ? current.target_ref : 'TEC';
    const label = typeof current.target_title === 'string' && current.target_title.trim() ? current.target_title : ref;
    const versions = this.coerceVersions(mutation.versions);
    // The undo card says which added versions stay; the original card says what it changes.
    const kept = Array.isArray(mutation.kept_versions)
      ? mutation.kept_versions.map((label) => String(label ?? '').trim()).filter(Boolean)
      : [];

    let summary = `Preview ${preview.id} ${preview.status}.`;
    switch (preview.status) {
      case 'pending': summary = `Update the versions of ${label}.`; break;
      case 'executed': summary = `Versions updated on ${label}.`; break;
      case 'rejected': summary = `Versions preview for ${label} was rejected.`; break;
      case 'expired': summary = `Versions preview for ${label} expired before approval.`; break;
      case 'failed': summary = preview.error_message || `Versions preview for ${label} failed.`; break;
    }
    if (language !== 'en') {
      summary = previewSummaryText(
        language,
        preview.status,
        writeActionText.updateTechnologyVersions(language, quoted(language, label)),
        { errorMessage: preview.error_message },
      );
    }

    const update: TechnologyVersionEditUpdate[] = versions.update.map((entry) => {
      const next = entry.next;
      return {
        label: entry.before.label,
        next_label: typeof next.label === 'string' && next.label !== entry.before.label ? next.label : null,
        old_end: endOf(entry.before),
        new_end: endOf({
          standard_support_end: 'standard_support_end' in next ? next.standard_support_end : entry.before.standard_support_end,
          extended_support_end: 'extended_support_end' in next ? next.extended_support_end : entry.before.extended_support_end,
        }),
        notes: 'notes' in next
          ? ((next.notes ?? null) === (entry.before.notes ?? null) ? null : (next.notes == null ? 'cleared' : 'updated'))
          : null,
        catalog: !!entry.before.catalog_key,
      };
    });
    const text = technologyVersionEditCardText(language, {
      add: versions.add.map((entry) => ({ label: entry.label, end: endOf(entry) })),
      update,
      kept,
    });
    const changes: Record<string, AiMutationPreviewPresentation['changes'][string]> = {};
    if (text) {
      changes.technology_versions = {
        label: { en: 'Versions', fr: 'Versions', de: 'Versionen', es: 'Versiones' }[language],
        from: null,
        to: text,
        format: 'markdown',
      };
    }
    return {
      target: {
        entity_type: 'technologies',
        entity_id: preview.target_entity_id ?? null,
        ref: typeof current.target_ref === 'string' ? current.target_ref : null,
        title: label,
      },
      changes,
      summary,
    };
  }

  async executePreview(context: AiExecutionContextWithManager, preview: AiMutationPreview): Promise<void> {
    if (!preview.target_entity_id) throw new BadRequestException('Preview is missing the technology.');
    const technology = await this.support.lockTechnology(context, preview.target_entity_id);
    const versions = this.coerceVersions(preview.mutation_input?.versions);
    const live = await this.readVersions(context, technology.id);
    this.assertNoDrift(technology, versions, live);
    const opts = {
      manager: context.manager,
      tenantId: context.tenantId,
      userId: context.userId ?? null,
      audit: buildAiMutationAudit(preview),
    };
    const applied: Applied = { created: [], updated: [] };
    for (const entry of versions.add) {
      const created = await this.technologies.createVersion(technology.id, {
        label: entry.label,
        standard_support_end: entry.standard_support_end,
        extended_support_end: entry.extended_support_end,
        notes: entry.notes,
      }, opts);
      applied.created.push({ id: String(created.id), label: String(created.label) });
    }
    for (const entry of versions.update) {
      await this.technologies.updateVersion(technology.id, entry.id, entry.next, opts);
      const after = (await this.readVersions(context, technology.id)).find((row) => row.id === entry.id);
      if (!after) throw new ConflictException(`Versions of ${technology.label} changed after the preview was created.`);
      applied.updated.push({ id: entry.id, before: entry.before, after });
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
    const applied = this.coerceApplied(preview.current_values?.applied);
    if (!applied || (applied.updated.length === 0 && applied.created.length === 0)) {
      throw new BadRequestException('This preview changed no version.');
    }
    // An added version stays (decision 12): an undo with nothing to put back has nothing to do.
    if (applied.updated.length === 0) {
      throw new BadRequestException('Nothing to undo: the preview added versions, and an added version stays.');
    }
    if (!preview.target_entity_id) throw new BadRequestException('Original preview is missing the technology.');
    const technology = await this.support.lockTechnology(context, preview.target_entity_id);
    const live = await this.readVersions(context, technology.id);
    const update: Array<{ id: string; before: VersionRow; next: Record<string, unknown> }> = [];
    for (const entry of applied.updated) {
      const current = live.find((row) => row.id === entry.id);
      // The undo restores the exact version it changed: another label, date or note is not ours.
      if (!current || !sameRow(current, entry.after)) {
        throw new ConflictException(`Versions of ${technology.label} changed after the preview was created.`);
      }
      update.push({
        id: entry.id,
        before: current,
        next: {
          label: entry.before.label,
          standard_support_end: entry.before.standard_support_end,
          extended_support_end: entry.before.extended_support_end,
          notes: entry.before.notes,
        },
      });
    }
    return {
      targetEntityType: 'technologies',
      targetEntityId: technology.id,
      mutationInput: {
        technology_ref: technology.ref,
        technology_name: technology.name,
        technology_label: technology.label,
        versions: { add: [], update },
        kept_versions: applied.created.map((version) => version.label),
        reverse_of: preview.id,
      },
      currentValues: {
        target_ref: technology.ref,
        target_title: technology.label,
      },
    };
  }

  /**
   * The request as the operation takes it, including from a plan step, which reaches
   * `prepareCreatePreview` without the Zod schema: an empty request and every unknown or
   * unsupported key is refused here, in words.
   */
  private normalizeRequest(input: UpdateTechnologyVersionsInput | Record<string, unknown>): UpdateTechnologyVersionsInput {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('Nothing to change: add a version or change one.');
    }
    const raw = input as Record<string, unknown>;
    for (const key of Object.keys(raw)) {
      const message = VERSION_UNSUPPORTED_MESSAGES[key];
      if (message) throw new BadRequestException(message);
    }
    assertKnownKeys(raw, ['technology', 'add', 'update'], 'update_technology_versions');
    const technology = trimmed(raw.technology);
    if (!technology) throw new BadRequestException('A technology is required.');
    if (raw.add !== undefined && !Array.isArray(raw.add)) throw new BadRequestException('add must be a list.');
    if (raw.update !== undefined && !Array.isArray(raw.update)) throw new BadRequestException('update must be a list.');
    const add = (raw.add ?? []) as Array<Record<string, unknown>>;
    const update = (raw.update ?? []) as Array<Record<string, unknown>>;
    if (add.length === 0 && update.length === 0) {
      throw new BadRequestException('Nothing to change: add a version or change one.');
    }
    for (const entry of add) {
      assertVersionKeys(entry, ['label', 'standard_support_end', 'extended_support_end', 'notes'], 'update_technology_versions add');
      if (!trimmed(entry.label)) throw new BadRequestException('Every version to add needs a label.');
    }
    for (const entry of update) {
      assertVersionKeys(entry, ['version', 'label', 'standard_support_end', 'extended_support_end', 'notes'], 'update_technology_versions update');
      if (!trimmed(entry.version)) throw new BadRequestException('Every version to update needs its current label.');
    }
    return { technology, add, update } as unknown as UpdateTechnologyVersionsInput;
  }

  private normalizeChanges(input: UpdateTechnologyVersionsInput, live: VersionRow[]): StoredVersions {
    const add: VersionAdd[] = [];
    const update: VersionUpdate[] = [];
    const labels = new Map(live.map((row) => [versionKey(row.label), row]));
    const incoming = new Set<string>();

    for (const entry of input.add ?? []) {
      const label = trimmed(entry.label);
      const key = versionKey(label);
      if (labels.has(key) || incoming.has(key)) throw new ConflictException('This version already exists.');
      incoming.add(key);
      const standard = 'standard_support_end' in entry ? dayOf(entry.standard_support_end, 'Standard support end') : null;
      const extended = 'extended_support_end' in entry ? dayOf(entry.extended_support_end, 'Extended support end') : null;
      assertConsistent(standard, extended);
      add.push({
        label,
        standard_support_end: standard,
        extended_support_end: extended,
        notes: 'notes' in entry ? notesOf(entry.notes) : null,
      });
    }

    const seen = new Set<string>();
    for (const entry of input.update ?? []) {
      const label = trimmed(entry.version);
      const current = labels.get(versionKey(label));
      if (!current) throw new NotFoundException(`Version "${label}" not found.`);
      if (seen.has(current.id)) throw new BadRequestException(`Version "${label}" is named more than once.`);
      seen.add(current.id);
      const next: Record<string, unknown> = {};
      let labelChanged = false;
      if ('label' in entry) {
        const newLabel = trimmed(entry.label);
        if (versionKey(newLabel) !== versionKey(current.label)) {
          const holder = labels.get(versionKey(newLabel));
          if ((holder && holder.id !== current.id) || incoming.has(versionKey(newLabel))) {
            throw new ConflictException('This version already exists.');
          }
          incoming.add(versionKey(newLabel));
          labelChanged = true;
        }
        next.label = newLabel;
      }
      if ('standard_support_end' in entry) next.standard_support_end = dayOf(entry.standard_support_end, 'Standard support end');
      if ('extended_support_end' in entry) next.extended_support_end = dayOf(entry.extended_support_end, 'Extended support end');
      if ('notes' in entry) next.notes = notesOf(entry.notes);
      if (Object.keys(next).length === 0) {
        throw new BadRequestException(`Version "${label}": at least one field to change is required.`);
      }
      const standard = 'standard_support_end' in next ? next.standard_support_end as string | null : current.standard_support_end;
      const extended = 'extended_support_end' in next ? next.extended_support_end as string | null : current.extended_support_end;
      assertConsistent(standard, extended);
      const unchanged = (!labelChanged || next.label === current.label)
        && (!('standard_support_end' in next) || (next.standard_support_end ?? null) === (current.standard_support_end ?? null))
        && (!('extended_support_end' in next) || (next.extended_support_end ?? null) === (current.extended_support_end ?? null))
        && (!('notes' in next) || (next.notes ?? null) === (current.notes ?? null));
      if (unchanged) throw new BadRequestException(`Version "${label}" already has the requested values.`);
      update.push({ id: current.id, before: current, next });
    }
    return { add, update };
  }

  private assertNoDrift(technology: AiTechnologyTarget, versions: StoredVersions, live: VersionRow[]): void {
    const conflict = () => new ConflictException(`Versions of ${technology.label} changed after the preview was created.`);
    for (const entry of versions.add) {
      if (live.some((row) => versionKey(row.label) === versionKey(entry.label))) throw conflict();
    }
    for (const entry of versions.update) {
      const current = live.find((row) => row.id === entry.id);
      if (!current || !sameRow(current, entry.before)) throw conflict();
    }
  }

  private async readVersions(context: AiExecutionContextWithManager, technologyId: string): Promise<VersionRow[]> {
    const rows: Array<Record<string, unknown>> = await context.manager.query(
      `SELECT id, label,
              to_char(standard_support_end, 'YYYY-MM-DD') AS standard_support_end,
              to_char(extended_support_end, 'YYYY-MM-DD') AS extended_support_end,
              notes, catalog_key
         FROM technology_versions
        WHERE tenant_id = $1 AND technology_id = $2
        ORDER BY lower(label), id`,
      [context.tenantId, technologyId],
    );
    return rows.map(versionRow);
  }

  private coerceVersions(value: unknown): StoredVersions {
    const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const add = (Array.isArray(raw.add) ? raw.add as Array<Record<string, unknown>> : []).map((entry) => ({
      label: String(entry.label ?? ''),
      standard_support_end: entry.standard_support_end ? String(entry.standard_support_end) : null,
      extended_support_end: entry.extended_support_end ? String(entry.extended_support_end) : null,
      notes: entry.notes == null ? null : String(entry.notes),
    }));
    const update = (Array.isArray(raw.update) ? raw.update as Array<Record<string, unknown>> : []).map((entry) => ({
      id: String(entry.id ?? ''),
      before: versionRow((entry.before && typeof entry.before === 'object' ? entry.before : {}) as Record<string, unknown>),
      next: (entry.next && typeof entry.next === 'object' ? entry.next : {}) as Record<string, unknown>,
    }));
    return { add, update };
  }

  private coerceApplied(value: unknown): Applied | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    const created = (Array.isArray(raw.created) ? raw.created as Array<Record<string, unknown>> : [])
      .map((row) => ({ id: String(row.id ?? ''), label: String(row.label ?? '') }))
      .filter((row) => row.id && row.label);
    const updated = (Array.isArray(raw.updated) ? raw.updated as Array<Record<string, unknown>> : [])
      .map((row) => ({
        id: String(row.id ?? ''),
        before: versionRow((row.before && typeof row.before === 'object' ? row.before : {}) as Record<string, unknown>),
        after: versionRow((row.after && typeof row.after === 'object' ? row.after : {}) as Record<string, unknown>),
      }))
      .filter((row) => row.id);
    return { created, updated };
  }
}
