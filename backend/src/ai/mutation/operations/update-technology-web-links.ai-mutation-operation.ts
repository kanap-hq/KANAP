import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { optionalText } from '../../../technologies/technology-rows';
import { TechnologiesService, webLinkUrl } from '../../../technologies/technologies.service';
import { AiMutationPreview } from '../../ai-mutation-preview.entity';
import {
  AiWriteLanguage,
  previewSummaryText,
  quoted,
  technologyWebLinkAddText,
  technologyWebLinkCardText,
  technologyWebLinkUpdateText,
  writeActionText,
} from '../../ai-write-texts';
import { AiExecutionContextWithManager } from '../../ai.types';
import { buildAiMutationAudit } from '../ai-mutation-audit.util';
import { AiMutationOperation, AiMutationPreviewPresentation, AiPreparedMutationPreview } from '../ai-mutation-operation.types';
import { AiTechnologyMutationSupportService } from '../ai-technology-mutation-support.service';

const LINK_ADD = z.object({
  url: z.string().trim().min(1).max(2000)
    .describe('Address of the link: http or https.'),
  description: z.string().max(2000).nullable().optional()
    .describe('Description, up to 2000 characters; omitted for none.'),
}).strict();

const LINK_UPDATE = z.object({
  url: z.string().trim().min(1).max(2000)
    .describe('Current address of the link to change.'),
  new_url: z.string().trim().min(1).max(2000).optional()
    .describe('New address, when it changes: http or https.'),
  description: z.string().max(2000).nullable().optional()
    .describe('New description; null clears it; absent leaves it.'),
}).strict();

const LINK_REMOVE = z.object({
  url: z.string().trim().min(1).max(2000)
    .describe('Current address of the link to remove.'),
}).strict();

export const UpdateTechnologyWebLinksInputSchema = z.object({
  technology: z.string().trim().min(1)
    .describe('Technology whose web links change: a TEC-n reference, its UUID or its exact name.'),
  add: z.array(LINK_ADD).max(100).optional()
    .describe('Links to add, each with an address and an optional description.'),
  update: z.array(LINK_UPDATE).max(100).optional()
    .describe('Links to change, each named by its current address, with a new address or description.'),
  remove: z.array(LINK_REMOVE).max(100).optional()
    .describe('Links to remove, each named by its exact address.'),
}).strict().refine((value) => (value.add?.length ?? 0) + (value.update?.length ?? 0) + (value.remove?.length ?? 0) > 0, {
  message: 'At least one web link to add, update or remove is required.',
});

type UpdateTechnologyWebLinksInput = z.infer<typeof UpdateTechnologyWebLinksInputSchema>;

type LinkRow = { id: string; url: string; description: string | null };
type LinkAdd = { url: string; description: string | null };
type LinkUpdate = { id: string; before: LinkRow; url: string; description: string | null; descriptionGiven: boolean };
type LinkRemove = { id: string; before: LinkRow };
type Stored = {
  add: LinkAdd[];
  update: LinkUpdate[];
  remove: LinkRemove[];
  already: LinkAdd[];
  absent: string[];
  before: LinkRow[];
};
type Applied = {
  before: LinkRow[];
  after: LinkRow[];
  added: LinkRow[];
  removed: LinkRow[];
  updated: Array<{ id: string; before: LinkRow; after: LinkRow }>;
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function linkKey(link: LinkRow): string {
  return `${link.id}:${link.url}:${link.description ?? ''}`;
}

function sameLinks(a: readonly LinkRow[], b: readonly LinkRow[]): boolean {
  const left = a.map(linkKey).sort();
  const right = b.map(linkKey).sort();
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function linkRow(row: Record<string, unknown>): LinkRow {
  return {
    id: text(row.id),
    url: text(row.url),
    description: row.description == null ? null : text(row.description) || null,
  };
}

/** A plan step reaches `prepareCreatePreview` without the Zod schema: the keys are checked here too. */
function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[], toolName: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) {
    throw new BadRequestException(`Unknown field "${unknown[0]}" for ${toolName}. Allowed: ${allowed.join(', ')}.`);
  }
}

@Injectable()
export class UpdateTechnologyWebLinksAiMutationOperation implements AiMutationOperation<UpdateTechnologyWebLinksInput> {
  readonly toolName = 'update_technology_web_links' as const;
  readonly description = 'Create a preview to add, change or remove the web links of a technology. Requires explicit user approval before execution.';
  readonly inputSchema = UpdateTechnologyWebLinksInputSchema;
  readonly inputSummary = {
    technology: 'Technology whose web links change: TEC-n, the UUID, or its exact name.',
    add: 'Links to add, each with a `url` (http or https) and an optional `description`.',
    update: 'Links to change, each named by its current `url`, with `new_url` or `description`; a description at null clears it.',
    remove: 'Links to remove, each named by its exact `url`.',
  };
  readonly businessResource = 'infrastructure';
  readonly writePreview = {
    entity_type: 'technologies',
    fields: ['technology_web_links'],
    reversible: true,
    prompt_hint: 'Use `update_technology_web_links` for the web links of a technology: name the technology (TEC-n, UUID or exact name), add `{url, description}`, change a link by its current `url` with `new_url` or `description`, remove one by its exact `url`. An address must be http or https; two links of the same address make the name ambiguous and are refused. Undo removes the added links, recreates the removed ones and restores the changed ones.',
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
    input: UpdateTechnologyWebLinksInput,
  ): Promise<AiPreparedMutationPreview> {
    const request = this.normalizeRequest(input);
    const technology = await this.support.resolveTechnology(context, request.technology);
    const before = await this.readLinks(context, technology.id);
    const stored = this.normalizeChanges(request, before);
    if (!stored.add.length && !stored.update.length && !stored.remove.length) {
      throw new BadRequestException(`Nothing to change: ${technology.label} already has these web links.`);
    }
    return {
      targetEntityType: 'technologies',
      targetEntityId: technology.id,
      mutationInput: {
        technology_ref: technology.ref,
        technology_name: technology.name,
        technology_label: technology.label,
        ...stored,
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
    const reverse = typeof mutation.reverse_of === 'string';
    let summary = `Preview ${preview.id} ${preview.status}.`;
    switch (preview.status) {
      case 'pending': summary = reverse ? `Restore the web links of ${label}.` : `Update the web links of ${label}.`; break;
      case 'executed': summary = reverse ? `Web links restored on ${label}.` : `Web links updated on ${label}.`; break;
      case 'rejected': summary = `${reverse ? 'Restore' : 'Web links'} preview for ${label} was rejected.`; break;
      case 'expired': summary = `${reverse ? 'Restore' : 'Web links'} preview for ${label} expired before approval.`; break;
      case 'failed': summary = preview.error_message || `${reverse ? 'Restore' : 'Web links'} preview for ${label} failed.`; break;
    }
    if (language !== 'en') {
      summary = previewSummaryText(
        language,
        preview.status,
        writeActionText.updateTechnologyWebLinks(language, quoted(language, label)),
        { errorMessage: preview.error_message },
      );
    }
    const group = reverse ? this.reverseCard(mutation, language) : this.forwardCard(mutation, language);
    const changes: Record<string, AiMutationPreviewPresentation['changes'][string]> = {};
    if (group) {
      changes.technology_web_links = {
        label: { en: 'Web links', fr: 'Liens web', de: 'Weblinks', es: 'Enlaces web' }[language],
        from: null,
        to: group,
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
    const opts = {
      manager: context.manager,
      tenantId: context.tenantId,
      userId: context.userId ?? null,
      audit: buildAiMutationAudit(preview),
    };
    const mutation = preview.mutation_input ?? {};
    const live = await this.readLinks(context, technology.id);
    if (typeof mutation.reverse_of === 'string') {
      const expected = this.coerceLinks(mutation.expected);
      const added = this.coerceLinks(mutation.added);
      const removed = this.coerceLinks(mutation.removed);
      const updated = this.coerceUpdated(mutation.updated);
      if (!sameLinks(live, expected)) {
        throw new ConflictException(`Web links of ${technology.label} changed after the preview was created.`);
      }
      // The links this preview added, still exactly as it wrote them (the whole set above): remove them.
      for (const link of added) await this.technologies.deleteLink(technology.id, link.id, opts);
      // The links it removed come back with their address and description.
      for (const link of removed) await this.technologies.createLink(technology.id, { url: link.url, description: link.description }, opts);
      // The links it changed go back to their previous address and description.
      for (const entry of updated) {
        await this.technologies.updateLink(technology.id, entry.id, { url: entry.before.url, description: entry.before.description }, opts);
      }
      const after = await this.readLinks(context, technology.id);
      preview.current_values = {
        ...(preview.current_values ?? {}),
        applied: {
          before: expected,
          after,
          added: removed,
          removed: added,
          updated: updated.map((entry) => ({ id: entry.id, before: entry.after, after: entry.before })),
        } satisfies Applied,
      };
      return;
    }
    const before = this.coerceLinks(mutation.before);
    const adds = this.coerceAdds(mutation.add);
    const updates = this.coerceUpdates(mutation.update);
    const removes = this.coerceRemoves(mutation.remove);
    if (!sameLinks(live, before)) {
      throw new ConflictException(`Web links of ${technology.label} changed after the preview was created.`);
    }
    const added: LinkRow[] = [];
    const removed: LinkRow[] = [];
    const updated: Array<{ id: string; before: LinkRow; after: LinkRow }> = [];
    // Remove first, so an address a removal frees can be reused by an update or an addition.
    for (const entry of removes) {
      await this.technologies.deleteLink(technology.id, entry.id, opts);
      removed.push(entry.before);
    }
    for (const entry of updates) {
      const saved = await this.technologies.updateLink(technology.id, entry.id, {
        url: entry.url,
        ...(entry.descriptionGiven ? { description: entry.description } : {}),
      }, opts);
      updated.push({ id: entry.id, before: entry.before, after: linkRow(saved as unknown as Record<string, unknown>) });
    }
    for (const entry of adds) {
      const saved = await this.technologies.createLink(technology.id, { url: entry.url, description: entry.description }, opts);
      added.push(linkRow(saved as unknown as Record<string, unknown>));
    }
    const written = await this.readLinks(context, technology.id);
    preview.current_values = {
      ...(preview.current_values ?? {}),
      applied: { before, after: written, added, removed, updated } satisfies Applied,
    };
  }

  async prepareReversePreview(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
  ): Promise<AiPreparedMutationPreview> {
    const applied = this.coerceApplied(preview.current_values?.applied);
    if (!applied || (!applied.added.length && !applied.removed.length && !applied.updated.length)) {
      throw new BadRequestException('This preview changed no web link.');
    }
    if (!preview.target_entity_id) throw new BadRequestException('Original preview is missing the technology.');
    const technology = await this.support.lockTechnology(context, preview.target_entity_id);
    const live = await this.readLinks(context, technology.id);
    if (!sameLinks(live, applied.after)) {
      throw new ConflictException(`Web links of ${technology.label} changed after the preview was created.`);
    }
    return {
      targetEntityType: 'technologies',
      targetEntityId: technology.id,
      mutationInput: {
        technology_ref: technology.ref,
        technology_name: technology.name,
        technology_label: technology.label,
        reverse_of: preview.id,
        expected: applied.after,
        added: applied.added,
        removed: applied.removed,
        updated: applied.updated,
      },
      currentValues: {
        target_ref: technology.ref,
        target_title: technology.label,
      },
    };
  }

  /** The request as the operation takes it, including from a plan step without the Zod schema. */
  private normalizeRequest(input: UpdateTechnologyWebLinksInput | Record<string, unknown>): UpdateTechnologyWebLinksInput {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('Nothing to change: add, update or remove a web link.');
    }
    const raw = input as Record<string, unknown>;
    assertKnownKeys(raw, ['technology', 'add', 'update', 'remove'], 'update_technology_web_links');
    const technology = text(raw.technology);
    if (!technology) throw new BadRequestException('A technology is required.');
    for (const key of ['add', 'update', 'remove'] as const) {
      if (raw[key] !== undefined && !Array.isArray(raw[key])) throw new BadRequestException(`${key} must be a list.`);
    }
    const add = (raw.add ?? []) as Array<Record<string, unknown>>;
    const update = (raw.update ?? []) as Array<Record<string, unknown>>;
    const remove = (raw.remove ?? []) as Array<Record<string, unknown>>;
    if (add.length + update.length + remove.length === 0) {
      throw new BadRequestException('Nothing to change: add, update or remove a web link.');
    }
    for (const entry of add) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new BadRequestException('Every link to add must be an object.');
      assertKnownKeys(entry, ['url', 'description'], 'add');
    }
    for (const entry of update) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new BadRequestException('Every link to update must be an object.');
      assertKnownKeys(entry, ['url', 'new_url', 'description'], 'update');
    }
    for (const entry of remove) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new BadRequestException('Every link to remove must be an object.');
      assertKnownKeys(entry, ['url'], 'remove');
    }
    return raw as unknown as UpdateTechnologyWebLinksInput;
  }

  private normalizeChanges(input: UpdateTechnologyWebLinksInput, before: LinkRow[]): Stored {
    const add: LinkAdd[] = [];
    const update: LinkUpdate[] = [];
    const remove: LinkRemove[] = [];
    const already: LinkAdd[] = [];
    const absent: string[] = [];
    // The addresses the request names: two links of the same address make the designation ambiguous.
    const byUrl = new Map<string, LinkRow[]>();
    for (const link of before) {
      const rows = byUrl.get(link.url) ?? [];
      rows.push(link);
      byUrl.set(link.url, rows);
    }
    const designated = new Set<string>();
    const designatedUrl = (url: string, purpose: 'update' | 'remove'): LinkRow | null => {
      const rows = byUrl.get(url) ?? [];
      if (rows.length > 1) {
        throw new BadRequestException(`Two links have the address "${url}"; use the screen to choose the right one.`);
      }
      if (designated.has(url)) {
        throw new BadRequestException(`The link "${url}" is named more than once.`);
      }
      designated.add(url);
      if (!rows[0]) {
        if (purpose === 'update') throw new NotFoundException(`Link "${url}" not found.`);
        return null;
      }
      return rows[0];
    };

    const planned = new Map(before.map((link) => [link.id, { ...link }]));
    const removedUrls = new Set<string>();
    for (const entry of input.remove ?? []) {
      const url = text(entry.url);
      const link = designatedUrl(url, 'remove');
      if (!link) {
        absent.push(url);
        continue;
      }
      remove.push({ id: link.id, before: link });
      removedUrls.add(link.url);
      planned.delete(link.id);
    }

    for (const entry of input.update ?? []) {
      const url = text(entry.url);
      const link = designatedUrl(url, 'update');
      if (!link) continue;
      const descriptionGiven = Object.prototype.hasOwnProperty.call(entry, 'description');
      const newUrl = entry.new_url === undefined ? link.url : webLinkUrl(entry.new_url);
      if (newUrl !== link.url) {
        // The projected set: an address a removal frees can be taken, an address the set still
        // holds (untouched or updated) cannot.
        const newHolder = [...planned.values()].find((row) => row.id !== link.id && row.url === newUrl);
        if (newHolder) throw new BadRequestException(`A link with the address "${newUrl}" already exists.`);
      }
      const description = descriptionGiven ? optionalText(entry.description, 'Description', 2000) : link.description;
      const next = { id: link.id, url: newUrl, description };
      if (next.url === link.url && (next.description ?? null) === (link.description ?? null)) continue;
      update.push({ id: link.id, before: link, url: next.url, description: next.description, descriptionGiven });
      planned.set(link.id, next);
    }

    for (const entry of input.add ?? []) {
      const url = webLinkUrl(entry.url);
      const description = optionalText(entry.description, 'Description', 2000);
      // The projected set after the removals and the updates: an addition may not create a second
      // link of an address the set would hold, nor put back an address the same request removes.
      if (removedUrls.has(url)) {
        throw new BadRequestException(`The link "${url}" is removed and added in the same request: keep one.`);
      }
      if ([...planned.values()].some((link) => link.url === url)) {
        throw new BadRequestException(`A link with the address "${url}" already exists.`);
      }
      add.push({ url, description });
      planned.set(`new:${url}`, { id: `new:${url}`, url, description });
    }

    return {
      add,
      update,
      remove,
      already,
      absent,
      before,
    };
  }

  private forwardCard(mutation: Record<string, unknown>, language: AiWriteLanguage): string | null {
    const group = {
      add: this.coerceAdds(mutation.add).map((entry) => technologyWebLinkAddText(entry.url, entry.description)),
      update: this.coerceUpdates(mutation.update).map((entry) => technologyWebLinkUpdateText(
        language, entry.before, { url: entry.url, description: entry.description }, entry.descriptionGiven,
      )),
      remove: this.coerceRemoves(mutation.remove).map((entry) => entry.before.url),
      already: this.coerceAdds(mutation.already).map((entry) => entry.url),
      absent: (Array.isArray(mutation.absent) ? mutation.absent : []).map((url) => text(url)).filter(Boolean),
    };
    return technologyWebLinkCardText(language, group);
  }

  private reverseCard(mutation: Record<string, unknown>, language: AiWriteLanguage): string | null {
    const added = this.coerceLinks(mutation.added);
    const removed = this.coerceLinks(mutation.removed);
    const updated = this.coerceUpdated(mutation.updated);
    return technologyWebLinkCardText(language, {
      add: removed.map((link) => technologyWebLinkAddText(link.url, link.description)),
      update: updated.map((entry) => technologyWebLinkUpdateText(language, entry.after, entry.before, true)),
      remove: added.map((link) => link.url),
      already: [],
      absent: [],
    });
  }

  private async readLinks(context: AiExecutionContextWithManager, technologyId: string): Promise<LinkRow[]> {
    const rows = await this.technologies.listLinks(technologyId, { manager: context.manager, tenantId: context.tenantId });
    return (rows as Array<Record<string, unknown>>).map(linkRow);
  }

  private coerceLinks(value: unknown): LinkRow[] {
    return (Array.isArray(value) ? value as Array<Record<string, unknown>> : []).map(linkRow).filter((row) => row.id);
  }

  private coerceAdds(value: unknown): LinkAdd[] {
    return (Array.isArray(value) ? value as Array<Record<string, unknown>> : []).map((row) => ({
      url: text(row.url),
      description: row.description == null ? null : text(row.description) || null,
    })).filter((row) => row.url);
  }

  private coerceUpdates(value: unknown): LinkUpdate[] {
    return (Array.isArray(value) ? value as Array<Record<string, unknown>> : []).map((row) => ({
      id: text(row.id),
      before: linkRow(row.before && typeof row.before === 'object' ? row.before as Record<string, unknown> : {}),
      url: text(row.url),
      description: row.description == null ? null : text(row.description) || null,
      descriptionGiven: row.descriptionGiven !== false,
    })).filter((row) => row.id);
  }

  private coerceRemoves(value: unknown): LinkRemove[] {
    return (Array.isArray(value) ? value as Array<Record<string, unknown>> : []).map((row) => ({
      id: text(row.id),
      before: linkRow(row.before && typeof row.before === 'object' ? row.before as Record<string, unknown> : {}),
    })).filter((row) => row.id);
  }

  private coerceUpdated(value: unknown): Array<{ id: string; before: LinkRow; after: LinkRow }> {
    return (Array.isArray(value) ? value as Array<Record<string, unknown>> : []).map((row) => ({
      id: text(row.id),
      before: linkRow(row.before && typeof row.before === 'object' ? row.before as Record<string, unknown> : {}),
      after: linkRow(row.after && typeof row.after === 'object' ? row.after as Record<string, unknown> : {}),
    })).filter((row) => row.id);
  }

  private coerceApplied(value: unknown): Applied | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    return {
      before: this.coerceLinks(raw.before),
      after: this.coerceLinks(raw.after),
      added: this.coerceLinks(raw.added),
      removed: this.coerceLinks(raw.removed),
      updated: this.coerceUpdated(raw.updated),
    };
  }
}
