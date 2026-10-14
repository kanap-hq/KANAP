import { BadRequestException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { decodeHtmlEntities } from '../../../common/html-entities';
import type { ImportedImageReference } from '../../../common/document-import-markdown';
import { assertMarkdownSize } from '../../../common/markdown-limits';
import {
  findImportedImageReferences,
  htmlToMarkdown,
  MarkdownWorkBudget,
  markdownWorkBudget,
  normalizeMarkdownRichText,
  resolveHtmlContentSource,
} from '../../../common/markdown-worker';
import { TaskPriorityLevel } from '../../../tasks/task.entity';
import { TaskActivitiesService } from '../../../tasks/task-activities.service';
import { TaskAttachmentsService } from '../../../tasks/task-attachments.service';
import { TasksUnifiedService } from '../../../tasks/tasks-unified.service';
import { AiPolicyService } from '../../ai-policy.service';
import { AiMutationPreview } from '../../ai-mutation-preview.entity';
import { AiExecutionContextWithManager, AiMutationWriteToolName, AiWritePreviewCapabilityDto } from '../../ai.types';
import {
  AdapterResult,
  TicketAttachmentRef,
  TicketAttachmentReadResult,
  TicketNote,
  TicketRecord,
  TicketingProvider,
} from '../../control-plane/providers/provider.types';
import { LEGACY_GLPI_TICKETING_PROVIDER_KEY } from '../../control-plane/providers/provider-constants';
import { AiProviderRegistryService } from '../../control-plane/providers/provider-registry.service';
import {
  AiMutationOperation,
  AiMutationPreviewPresentation,
  AiPreparedMutationPreview,
} from '../ai-mutation-operation.types';
import { buildAiMutationAudit } from '../ai-mutation-audit.util';
import {
  AiTaskCreateTarget,
  AiTaskMutationSupportService,
} from '../ai-task-mutation-support.service';
import { findImgSourceValues } from '../../../common/text-scan';

const RELATION_TYPE_VALUES = ['standalone', 'project', 'spend_item', 'capex_item'] as const;
const PRIORITY_LEVEL_VALUES = ['blocker', 'high', 'normal', 'low', 'optional'] as const;

type TicketImportRelationType = typeof RELATION_TYPE_VALUES[number];
type TicketImportPriorityLevel = typeof PRIORITY_LEVEL_VALUES[number];

type LegacyImportTicketInput = {
  ticket_id: number;
  relation_type: TicketImportRelationType;
  relation_ref?: string | null;
  assignee?: string | null;
  priority_level?: TicketImportPriorityLevel | null;
};

type ImportTicketInput = Omit<LegacyImportTicketInput, 'ticket_id'> & {
  provider_key: string;
  ticket_id: string;
};

type StoredImportedFollowup = {
  id: string;
  content_html: string | null;
  author_label: string | null;
  date: string | null;
  is_private: boolean;
  image_targets: string[];
};

type ImportedImageOccurrence = {
  raw: string;
  target: string;
  index: number;
  rewrite: (nextTarget: string | null) => string;
};

function normalizeRelationType(value: unknown): unknown {
  if (value == null) {
    return undefined;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === 'opex' || normalized === 'budget' || normalized === 'budget_entry' || normalized === 'budget entry') {
    return 'spend_item';
  }
  if (normalized === 'capex') {
    return 'capex_item';
  }
  return normalized;
}

function textOrNull(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function toDisplayPriority(value: unknown): string | null {
  switch (String(value || '')) {
    case 'blocker':
      return 'Blocker';
    case 'high':
      return 'High';
    case 'normal':
      return 'Normal';
    case 'low':
      return 'Low';
    case 'optional':
      return 'Optional';
    default:
      return null;
  }
}

function toDisplayRelation(mutation: Record<string, unknown>): string {
  const relationType = textOrNull(mutation.relation_type) ?? 'standalone';
  const relationLabel = textOrNull(mutation.relation_label);
  if (relationType === 'standalone') {
    return 'Standalone';
  }
  return relationLabel ?? relationType;
}

function buildTarget(preview: AiMutationPreview): AiMutationPreviewPresentation['target'] {
  const current = preview.current_values ?? {};
  return {
    entity_type: 'tasks',
    entity_id: preview.target_entity_id ?? null,
    ref: typeof current.target_ref === 'string' ? current.target_ref : null,
    title: typeof current.target_title === 'string' ? current.target_title : null,
  };
}

function parseNumericLevel(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return null;
}

function mapSinglePriority(value: unknown): TicketImportPriorityLevel | null {
  const normalized = textOrNull(value)?.toLowerCase().replace(/[\s-]+/g, '_');
  switch (normalized) {
    case 'blocker':
    case 'critical':
    case 'major':
    case 'very_high':
      return 'blocker';
    case 'high':
      return 'high';
    case 'low':
      return 'low';
    case 'optional':
    case 'very_low':
      return 'optional';
    case 'normal':
    case 'medium':
      return 'normal';
  }
  switch (parseNumericLevel(value)) {
    case 6:
    case 5:
      return 'blocker';
    case 4:
      return 'high';
    case 3:
      return 'normal';
    case 2:
      return 'low';
    case 1:
      return 'optional';
    default:
      return null;
  }
}

function mapPriority(priority: unknown, urgency: unknown): TicketImportPriorityLevel {
  return mapSinglePriority(priority) ?? mapSinglePriority(urgency) ?? 'normal';
}

function mapTicketTaskTypeName(type: unknown): string | null {
  const normalized = textOrNull(type)?.toLowerCase().replace(/[\s-]+/g, '_');
  switch (normalized) {
    case 'incident':
    case 'request':
      return 'Incident';
    case 'task':
      return 'Task';
  }
  switch (parseNumericLevel(type)) {
    case 1:
      return 'Incident';
    case 2:
      return 'Task';
    default:
      return null;
  }
}

const HTML_ATTRIBUTE_ENTITIES = {
  amp: '&',
  quot: '"',
  '#39': '\'',
  '#38': '&',
  '#34': '"',
  '#60': '<',
  '#62': '>',
  lt: '<',
  gt: '>',
};

function decodeHtmlAttribute(value: string): string {
  return decodeHtmlEntities(String(value || ''), { entities: HTML_ATTRIBUTE_ENTITIES, ignoreCase: true });
}

function extractImageTargets(html: string | null): string[] {
  if (!html) {
    return [];
  }

  const seen = new Set<string>();
  const results: string[] = [];
  for (const value of findImgSourceValues(html)) {
    const rawTarget = decodeHtmlAttribute(value.trim());
    if (!rawTarget || seen.has(rawTarget)) {
      continue;
    }
    seen.add(rawTarget);
    results.push(rawTarget);
  }
  return results;
}

function buildSourceFooter(
  ticket: TicketRecord,
  sourceUri: string | null,
  options: {
    sourceLabel: string;
    sourceUrlLabel: string;
    providerKey?: string | null;
  },
): string {
  const lines = [
    '---',
    `Source: ${options.sourceLabel} #${ticket.id}`,
    sourceUri ? `${options.sourceUrlLabel}: ${sourceUri}` : null,
    options.providerKey ? `Provider: ${options.providerKey}` : null,
    ticket.status ? `Status: ${ticket.status}` : null,
    ticket.priority != null ? `Priority: ${ticket.priority}` : null,
    ticket.type != null ? `Type: ${ticket.type}` : null,
  ].filter((line): line is string => !!line);

  return lines.join('\n');
}

async function buildDescription(
  ticket: TicketRecord,
  contentHtml: string | null,
  sourceUri: string | null,
  sourceOptions: Parameters<typeof buildSourceFooter>[2],
  budget: MarkdownWorkBudget,
): Promise<string> {
  const converted = await htmlToMarkdown(contentHtml || '', { fieldName: 'description', budget });
  const sections = [textOrNull(converted), buildSourceFooter(ticket, sourceUri, sourceOptions)].filter((part): part is string => !!part);
  return sections.join('\n\n');
}

function buildImportedFollowupComment(
  sourceLabel: string,
  ticketId: string,
  followup: StoredImportedFollowup,
  markdownBody: string,
): string {
  const lines = [
    `Source: ${sourceLabel} #${ticketId} followup #${followup.id}`,
    `Author: ${textOrNull(followup.author_label) ?? 'Unknown'}`,
    `Date: ${textOrNull(followup.date) ?? 'Unknown'}`,
    '---',
    textOrNull(markdownBody) ?? '(empty comment)',
  ];
  return lines.join('\n');
}

function parseProviderDate(value: string | null): Date | null {
  const text = textOrNull(value);
  if (!text) {
    return null;
  }
  const parsed = new Date(text.replace(' ', 'T'));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function normalizeStoredFollowup(value: unknown): StoredImportedFollowup | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = textOrNull(record.id);
  if (!id) {
    return null;
  }
  return {
    id,
    content_html: textOrNull(record.content_html),
    author_label: textOrNull(record.author_label),
    date: textOrNull(record.date),
    is_private: record.is_private === true,
    image_targets: Array.isArray(record.image_targets)
      ? record.image_targets.map((target) => String(target || '').trim()).filter(Boolean)
      : [],
  };
}

function buildMulterFile(document: { buffer: Buffer; mimeType: string; filename: string }): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: document.filename,
    encoding: '7bit',
    mimetype: document.mimeType,
    size: document.buffer.length,
    buffer: document.buffer,
    destination: '',
    filename: document.filename,
    path: '',
    stream: undefined as any,
  };
}

function registerReplacementKeys(
  replacements: Map<string, string>,
  rawTarget: string,
  inlineUrl: string,
  sourceUri?: string | null,
): void {
  const decoded = decodeHtmlAttribute(rawTarget.trim());
  for (const candidate of [rawTarget.trim(), decoded]) {
    if (candidate) {
      replacements.set(candidate, inlineUrl);
    }
  }

  if (sourceUri) {
    try {
      replacements.set(new URL(decoded, sourceUri).toString(), inlineUrl);
    } catch {
      // Keep the raw forms only when URL resolution fails.
    }
  }
}

function unwrapAdapterResult<T>(result: AdapterResult<T>, fallbackMessage: string): T {
  if (result.ok === false) {
    throw new BadRequestException(result.message ?? fallbackMessage);
  }
  return result.data;
}

function ticketSourceUri(ticket: TicketRecord): string | null {
  return textOrNull(ticket.sourceUri)
    ?? textOrNull(ticket.attachments?.find((attachment) => textOrNull(attachment.sourceUri))?.sourceUri);
}

function attachmentTargets(
  attachments: TicketAttachmentRef[] | null | undefined,
  source: TicketAttachmentRef['source'],
): string[] {
  return (attachments ?? [])
    .filter((attachment) => attachment.source === source && attachment.kind === 'image')
    .map((attachment) => textOrNull(attachment.target))
    .filter((target): target is string => !!target);
}

function storedFollowupFromNote(note: TicketNote): StoredImportedFollowup {
  const attachments = note.attachments ?? [];
  return {
    id: note.id,
    content_html: textOrNull(note.bodyHtml) ?? textOrNull(note.body),
    author_label: textOrNull(note.author),
    date: textOrNull(note.createdAt),
    is_private: note.visibility !== 'public',
    image_targets: attachmentTargets(attachments, 'ticket_note'),
  };
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
}

function mutationArray(primary: unknown, fallback: unknown): string[] {
  const primaryValues = arrayOfStrings(primary);
  return primaryValues.length > 0 ? primaryValues : arrayOfStrings(fallback);
}

function mutationFollowups(primary: unknown, fallback: unknown): StoredImportedFollowup[] {
  const source = Array.isArray(primary) ? primary : fallback;
  return Array.isArray(source)
    ? source.map(normalizeStoredFollowup).filter((item): item is StoredImportedFollowup => !!item && !item.is_private)
    : [];
}

function attachmentRefForTarget(
  attachments: TicketAttachmentRef[] | null | undefined,
  target: string,
): TicketAttachmentRef | null {
  return (attachments ?? []).find((attachment) => attachment.target === target) ?? null;
}

/** The images of a Markdown text (found in the Markdown workers), with their rewrite. */
async function findImageOccurrences(markdown: string, budget?: MarkdownWorkBudget): Promise<ImportedImageOccurrence[]> {
  const references = await findImportedImageReferences(markdown, { fieldName: 'content', budget });
  return references.map((reference) => {
    const { raw, target } = reference;
    return {
      raw,
      target,
      index: reference.index,
      rewrite: reference.kind === 'markdown'
        ? (nextTarget: string | null) => (nextTarget ? raw.replace(target, nextTarget) : '')
        : (nextTarget: string | null) => (nextTarget ? buildMarkdownImage(reference, nextTarget) : ''),
    };
  });
}

function applyReplacements(
  content: string,
  replacements: Array<{ raw: string; replacement: string }>,
): string {
  if (replacements.length === 0) {
    return String(content || '');
  }

  let cursor = 0;
  let output = '';
  const text = String(content || '');

  for (const entry of replacements) {
    const nextIndex = text.indexOf(entry.raw, cursor);
    if (nextIndex < 0) {
      throw new BadRequestException('Failed to rewrite ticket inline image references.');
    }
    output += text.slice(cursor, nextIndex);
    output += entry.replacement;
    cursor = nextIndex + entry.raw.length;
  }

  output += text.slice(cursor);
  return output;
}

export function buildMarkdownImage(reference: ImportedImageReference, target: string): string {
  const alt = reference.alt ?? '';
  const title = reference.title ?? null;
  const encodedTitle = title ? ` "${String(title).replace(/[\\"]/g, '\\$&')}"` : '';
  return `![${alt}](${target}${encodedTitle})`;
}

async function rewriteMarkdownImageTargets(
  markdown: string,
  replacements: Map<string, string>,
  budget?: MarkdownWorkBudget,
): Promise<string> {
  const applied = (await findImageOccurrences(markdown, budget))
    .map((occurrence) => {
      const replacement = replacements.get(occurrence.target);
      if (!replacement) {
        return null;
      }
      return {
        raw: occurrence.raw,
        replacement: occurrence.rewrite(replacement),
      };
    })
    .filter((entry): entry is { raw: string; replacement: string } => !!entry);

  return applyReplacements(markdown, applied);
}

const LegacyImportTicketInputSchema = z.object({
  ticket_id: z.number().int().positive()
    .describe('GLPI ticket numeric identifier.'),
  relation_type: z.preprocess(
    normalizeRelationType,
    z.enum(RELATION_TYPE_VALUES).optional(),
  ).describe('Optional relation type. Use `project`, `spend_item`, `capex_item`, or `standalone`. Omit this to create a standalone task.'),
  relation_ref: z.union([z.string(), z.null()]).optional()
    .describe('Optional relation target reference. Required when relation_type is not standalone.'),
  assignee: z.union([z.string(), z.null()]).optional()
    .describe('Optional assignee email, full name, or unique user label in the current tenant.'),
  priority_level: z.union([z.enum(PRIORITY_LEVEL_VALUES), z.null()]).optional()
    .describe('Optional task priority override. Defaults to the GLPI priority mapping.'),
  priority: z.union([z.enum(PRIORITY_LEVEL_VALUES), z.null()]).optional()
    .describe('Alias for priority_level. Optional task priority override.'),
}).superRefine((value, ctx) => {
  const relationType = value.relation_type ?? 'standalone';
  const relationRef = textOrNull(value.relation_ref);
  if (relationType !== 'standalone' && !relationRef) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'relation_ref is required when relation_type is not standalone.',
      path: ['relation_ref'],
    });
  }
  if (relationType === 'standalone' && relationRef) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'relation_ref must be omitted when relation_type is standalone.',
      path: ['relation_ref'],
    });
  }
  if (
    value.priority_level != null
    && value.priority != null
    && value.priority_level !== value.priority
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '`priority_level` and `priority` must match when both are provided.',
      path: ['priority'],
    });
  }
}).transform((value): LegacyImportTicketInput => ({
  ticket_id: value.ticket_id,
  relation_type: value.relation_type ?? 'standalone',
  relation_ref: textOrNull(value.relation_ref),
  assignee: textOrNull(value.assignee),
  priority_level: value.priority_level ?? value.priority ?? null,
}));

const ImportTicketInputSchema = z.object({
  provider_key: z.string().trim().min(1)
    .describe('Configured ticketing provider key, for example `glpi` or another tenant adapter key.'),
  ticket_id: z.union([
    z.string().trim().min(1),
    z.number().int().positive(),
  ]).describe('Ticket identifier in the selected ticketing provider.'),
  relation_type: z.preprocess(
    normalizeRelationType,
    z.enum(RELATION_TYPE_VALUES).optional(),
  ).describe('Optional relation type. Use `project`, `spend_item`, `capex_item`, or `standalone`. Omit this to create a standalone task.'),
  relation_ref: z.union([z.string(), z.null()]).optional()
    .describe('Optional relation target reference. Required when relation_type is not standalone.'),
  assignee: z.union([z.string(), z.null()]).optional()
    .describe('Optional assignee email, full name, or unique user label in the current tenant.'),
  priority_level: z.union([z.enum(PRIORITY_LEVEL_VALUES), z.null()]).optional()
    .describe('Optional task priority override. Defaults to the provider priority mapping.'),
  priority: z.union([z.enum(PRIORITY_LEVEL_VALUES), z.null()]).optional()
    .describe('Alias for priority_level. Optional task priority override.'),
}).superRefine((value, ctx) => {
  const relationType = value.relation_type ?? 'standalone';
  const relationRef = textOrNull(value.relation_ref);
  if (relationType !== 'standalone' && !relationRef) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'relation_ref is required when relation_type is not standalone.',
      path: ['relation_ref'],
    });
  }
  if (relationType === 'standalone' && relationRef) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'relation_ref must be omitted when relation_type is standalone.',
      path: ['relation_ref'],
    });
  }
  if (
    value.priority_level != null
    && value.priority != null
    && value.priority_level !== value.priority
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '`priority_level` and `priority` must match when both are provided.',
      path: ['priority'],
    });
  }
}).transform((value): ImportTicketInput => ({
  provider_key: value.provider_key.trim(),
  ticket_id: String(value.ticket_id).trim(),
  relation_type: value.relation_type ?? 'standalone',
  relation_ref: textOrNull(value.relation_ref),
  assignee: textOrNull(value.assignee),
  priority_level: value.priority_level ?? value.priority ?? null,
}));

abstract class BaseImportTicketAiMutationOperation<TInput extends LegacyImportTicketInput | ImportTicketInput> implements AiMutationOperation<TInput> {
  readonly toolName: AiMutationWriteToolName = 'import_glpi_ticket';
  readonly description: string = 'Deprecated compatibility tool for importing one GLPI ticket into one KANAP task. Prefer import_ticket with provider_key `glpi` for new previews.';
  readonly inputSchema: z.ZodTypeAny = LegacyImportTicketInputSchema;
  readonly inputSummary: Record<string, string> = {
    ticket_id: 'GLPI ticket numeric identifier.',
    relation_type: 'Optional relation type: project, spend_item, capex_item, or standalone.',
    relation_ref: 'Optional relation target reference. Required when relation_type is project, spend_item, or capex_item.',
    assignee: 'Optional assignee email, full name, or unique user label in the current tenant.',
    priority_level: 'Optional task priority override. Defaults to the GLPI priority mapping.',
    priority: 'Alias for priority_level.',
  };
  readonly businessResource = 'tasks';
  readonly writePreview: AiWritePreviewCapabilityDto = {
    entity_type: 'tasks',
    fields: ['relation', 'title', 'description', 'assignee', 'priority_level', 'task_type', 'source', 'comments'],
    reversible: false,
    prompt_hint: 'Compatibility only. For new ticket escalation previews, prefer `import_ticket` with `provider_key: "glpi"` and `ticket_id`. The task requestor is always the current Plaid user.',
  };

  protected constructor(
    private readonly support: AiTaskMutationSupportService,
    private readonly tasks: TasksUnifiedService,
    private readonly attachments: TaskAttachmentsService,
    private readonly activities: TaskActivitiesService,
    private readonly providers: AiProviderRegistryService,
    private readonly policy: AiPolicyService,
  ) {}

  protected providerKeyForInput(_input: LegacyImportTicketInput | ImportTicketInput): string {
    return LEGACY_GLPI_TICKETING_PROVIDER_KEY;
  }

  protected providerKeyForMutation(mutation: Record<string, unknown>): string {
    return textOrNull(mutation.ticket_provider_key) ?? LEGACY_GLPI_TICKETING_PROVIDER_KEY;
  }

  protected sourceLabels(providerKey: string): { sourceLabel: string; sourceUrlLabel: string; providerKey?: string | null } {
    return providerKey === LEGACY_GLPI_TICKETING_PROVIDER_KEY
      ? { sourceLabel: 'GLPI Ticket', sourceUrlLabel: 'GLPI URL' }
      : { sourceLabel: 'Ticket', sourceUrlLabel: 'Source URL', providerKey };
  }

  protected fallbackTitle(ticket: TicketRecord, providerKey: string): string {
    return providerKey === LEGACY_GLPI_TICKETING_PROVIDER_KEY
      ? `GLPI Ticket #${ticket.id}`
      : `Ticket #${ticket.id}`;
  }

  protected importedCommentContext(_mutation: Record<string, unknown>): string {
    return 'glpi_import';
  }

  private async assertRelationAccess(
    context: AiExecutionContextWithManager,
    relation: AiTaskCreateTarget,
  ): Promise<void> {
    if (relation.mode === 'project') {
      await this.policy.assertBusinessPermission(context, 'portfolio_projects', 'contributor', context.manager);
    }
  }

  private async resolveMappedTaskType(
    context: AiExecutionContextWithManager,
    ticketType: unknown,
  ) {
    const mappedName = mapTicketTaskTypeName(ticketType);
    if (!mappedName) {
      return null;
    }

    try {
      return await this.support.resolveTaskType(context, mappedName);
    } catch {
      return null;
    }
  }

  private async loadCurrentTenantSlug(context: AiExecutionContextWithManager): Promise<string> {
    const rows = await context.manager.query<Array<{ slug: string | null }>>(
      `SELECT slug
       FROM tenants
       WHERE id = $1
       LIMIT 1`,
      [context.tenantId],
    );
    const slug = textOrNull(rows[0]?.slug);
    return slug || context.tenantId;
  }

  private async importInlineImagesForSourceField(params: {
    taskId: string;
    context: AiExecutionContextWithManager;
    provider: TicketingProvider;
    ticketId: string;
    tenantSlug: string;
    rawTargets: string[];
    attachmentRefs?: TicketAttachmentRef[] | null;
    sourceField: 'description' | 'content';
  }): Promise<{ replacements: Map<string, string>; importedCount: number; warnings: string[] }> {
    const replacements = new Map<string, string>();
    const warnings: string[] = [];
    let importedCount = 0;

    for (const rawTarget of [...new Set(params.rawTargets.map((target) => String(target || '').trim()).filter(Boolean))]) {
      try {
        const attachmentRef = attachmentRefForTarget(params.attachmentRefs, rawTarget);
        const read = unwrapAdapterResult<TicketAttachmentReadResult>(
          await params.provider.readTicketAttachment(params.context, {
            ticketId: params.ticketId,
            target: rawTarget,
            source: attachmentRef?.source ?? (params.sourceField === 'content' ? 'ticket_note' : 'ticket_description'),
            sourceNoteId: attachmentRef?.sourceNoteId ?? null,
          }),
          `Ticket attachment ${rawTarget} could not be read.`,
        );
        const document = {
          buffer: Buffer.from(read.base64Data, 'base64'),
          mimeType: read.mimeType,
          filename: read.filename ?? attachmentRef?.filename ?? 'ticket-attachment',
        };
        const attachment = await this.attachments.uploadAttachment(
          params.taskId,
          buildMulterFile(document),
          params.context.userId,
          {
            manager: params.context.manager,
            sourceField: params.sourceField,
          },
        );
        const inlineUrl = `/api/tasks/attachments/${params.tenantSlug}/${attachment.id}/inline`;
        registerReplacementKeys(replacements, rawTarget, inlineUrl, read.attachment.sourceUri ?? attachmentRef?.sourceUri ?? null);
        importedCount += 1;
      } catch (error: any) {
        warnings.push(
          `Skipped ticket ${params.sourceField} image ${rawTarget}: ${String(error?.message || error || 'unknown error')}`,
        );
      }
    }

    return { replacements, importedCount, warnings };
  }

  async prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: TInput,
  ): Promise<AiPreparedMutationPreview> {
    const requestor = await this.support.resolveCurrentUser(context);
    const relation = await this.support.resolveCreateTarget(context, input.relation_type, input.relation_ref);
    await this.assertRelationAccess(context, relation);

    const assignee = input.assignee
      ? await this.support.resolveUserReference(context, input.assignee)
      : null;

    const providerKey = this.providerKeyForInput(input);
    const provider = await this.providers.ticketing(context, providerKey);
    const ticketId = String(input.ticket_id);
    const ticket = unwrapAdapterResult(
      await provider.getTicket(context, { ticketId }),
      `Ticket ${ticketId} could not be read.`,
    );
    const notes = unwrapAdapterResult(
      await provider.listTicketNotes(context, { ticketId }),
      `Ticket ${ticketId} notes could not be read.`,
    ).notes;
    const followups = notes.map(storedFollowupFromNote);
    const publicFollowups = followups.filter((followup) => !followup.is_private);
    const privateFollowupCount = followups.length - publicFollowups.length;
    const contentSource = textOrNull(ticket.descriptionHtml) ?? textOrNull(ticket.description) ?? '';
    // The ticket text is bounded before its conversion to Markdown.
    assertMarkdownSize(contentSource, 'description');
    // The ticket text is converted in the Markdown workers, within one time budget.
    const budget = markdownWorkBudget();
    const normalizedContentHtml = textOrNull(await resolveHtmlContentSource(contentSource, { fieldName: 'description', budget }));
    const sourceUri = ticketSourceUri(ticket);
    const description = await normalizeMarkdownRichText(
      await buildDescription(ticket, normalizedContentHtml, sourceUri, this.sourceLabels(providerKey), budget),
      { fieldName: 'description', budget },
    );
    const taskType = await this.resolveMappedTaskType(context, ticket.type);
    const imageTargets = attachmentTargets(ticket.attachments, 'ticket_description');
    const fallbackImageTargets = imageTargets.length > 0 ? imageTargets : extractImageTargets(normalizedContentHtml);
    const followupImageTargets = publicFollowups.flatMap((followup) => followup.image_targets);
    const title = textOrNull(ticket.title) || this.fallbackTitle(ticket, providerKey);

    return {
      targetEntityType: 'tasks',
      targetEntityId: null,
      mutationInput: {
        relation_type: relation.mode,
        relation_id: relation.id,
        relation_ref: relation.ref,
        relation_label: relation.label,
        title,
        description,
        requestor_user_id: requestor.id,
        requestor_label: requestor.label,
        assignee_user_id: assignee?.id ?? null,
        assignee_label: assignee?.label ?? null,
        assignee_email: assignee?.email ?? null,
        priority_level: input.priority_level ?? mapPriority(ticket.priority, ticket.urgency),
        task_type_id: taskType?.id ?? null,
        task_type_label: taskType?.label ?? null,
        ticket_provider_kind: 'ticketing',
        ticket_provider_key: providerKey,
        ticket_id: ticket.id,
        ticket_source_url: sourceUri,
        ticket_image_targets: fallbackImageTargets,
        ticket_followups: publicFollowups,
        ticket_followup_public_count: publicFollowups.length,
        ticket_followup_private_skipped_count: privateFollowupCount,
        ticket_followup_image_total_count: followupImageTargets.length,
        // Legacy compatibility mirror — GLPI previews only. Non-GLPI providers
        // must not persist glpi_* keys (they would poison glpi_*-scoped
        // backfills and analytics with foreign provider data).
        ...(providerKey === LEGACY_GLPI_TICKETING_PROVIDER_KEY ? {
          glpi_ticket_id: ticket.id,
          glpi_source_url: sourceUri,
          glpi_image_targets: fallbackImageTargets,
          glpi_followups: publicFollowups,
          glpi_followup_public_count: publicFollowups.length,
          glpi_followup_private_skipped_count: privateFollowupCount,
          glpi_followup_image_total_count: followupImageTargets.length,
        } : {}),
        status: 'open',
      },
      currentValues: {
        target_ref: null,
        target_title: title,
        ticket_provider_kind: 'ticketing',
        ticket_provider_key: providerKey,
        ticket_id: ticket.id,
        ticket_source_url: sourceUri,
        ticket_image_total_count: fallbackImageTargets.length,
        ticket_followup_public_count: publicFollowups.length,
        ticket_followup_private_skipped_count: privateFollowupCount,
        ticket_followup_image_total_count: followupImageTargets.length,
        ...(providerKey === LEGACY_GLPI_TICKETING_PROVIDER_KEY ? {
          glpi_ticket_id: ticket.id,
          glpi_source_url: sourceUri,
          glpi_image_total_count: fallbackImageTargets.length,
          glpi_followup_public_count: publicFollowups.length,
          glpi_followup_private_skipped_count: privateFollowupCount,
          glpi_followup_image_total_count: followupImageTargets.length,
        } : {}),
      },
    };
  }

  presentPreview(preview: AiMutationPreview): AiMutationPreviewPresentation {
    const current = preview.current_values ?? {};
    const mutation = preview.mutation_input ?? {};
    const ref = textOrNull(current.target_ref);
    const title = textOrNull(current.target_title) ?? textOrNull(mutation.title) ?? 'Untitled task';
    const assigneeLabel = textOrNull(mutation.assignee_label);
    const priorityLabel = toDisplayPriority(mutation.priority_level) ?? 'Normal';
    const isGenericTool = preview.tool_name === 'import_ticket';
    const providerKey = textOrNull(current.ticket_provider_key)
      ?? textOrNull(mutation.ticket_provider_key)
      ?? (isGenericTool ? 'unknown' : LEGACY_GLPI_TICKETING_PROVIDER_KEY);
    const ticketId = textOrNull(current.ticket_id) ?? textOrNull(mutation.ticket_id) ?? textOrNull(current.glpi_ticket_id) ?? textOrNull(mutation.glpi_ticket_id) ?? 'unknown';
    const pendingTicketLabel = isGenericTool
      ? `ticket #${ticketId} from provider ${providerKey}`
      : `GLPI ticket #${ticketId}`;
    const createdTicketLabel = isGenericTool
      ? `ticket #${ticketId} from provider ${providerKey}`
      : `GLPI ticket #${ticketId}`;
    const imageTargets = mutationArray(mutation.ticket_image_targets, mutation.glpi_image_targets);
    const followups = Array.isArray(mutation.ticket_followups) ? mutation.ticket_followups : mutation.glpi_followups;
    const imageTotalCount = Number(current.ticket_image_total_count ?? current.glpi_image_total_count ?? imageTargets.length);
    const imageImportedCount = Number(current.ticket_image_imported_count ?? current.glpi_image_imported_count ?? 0);
    const followupPublicCount = Number(current.ticket_followup_public_count ?? current.glpi_followup_public_count ?? mutation.ticket_followup_public_count ?? mutation.glpi_followup_public_count ?? (Array.isArray(followups) ? followups.length : 0));
    const followupImportedCount = Number(current.ticket_followup_imported_count ?? current.glpi_followup_imported_count ?? 0);
    const privateFollowupSkippedCount = Number(current.ticket_followup_private_skipped_count ?? current.glpi_followup_private_skipped_count ?? mutation.ticket_followup_private_skipped_count ?? mutation.glpi_followup_private_skipped_count ?? 0);
    const followupImageTotalCount = Number(current.ticket_followup_image_total_count ?? current.glpi_followup_image_total_count ?? mutation.ticket_followup_image_total_count ?? mutation.glpi_followup_image_total_count ?? 0);
    const followupImageImportedCount = Number(current.ticket_followup_image_imported_count ?? current.glpi_followup_image_imported_count ?? 0);
    const warnings = Array.isArray(current.ticket_image_warnings) ? current.ticket_image_warnings : current.glpi_image_warnings;
    const warningCount = Array.isArray(warnings) ? warnings.length : 0;

    let summary = `Preview ${preview.id} ${preview.status}.`;
    switch (preview.status) {
      case 'pending':
        summary = mutation.relation_type === 'standalone'
          ? `Import ${pendingTicketLabel} as a standalone task "${title}".`
          : `Import ${pendingTicketLabel} as task "${title}" on ${toDisplayRelation(mutation)}.`;
        if (assigneeLabel) {
          summary += ` Assignee: ${assigneeLabel}.`;
        }
        summary += ` Priority: ${priorityLabel}.`;
        if (imageTotalCount > 0) {
          summary += ` ${imageTotalCount} inline image${imageTotalCount === 1 ? '' : 's'} queued for import.`;
        }
        if (followupPublicCount > 0) {
          summary += ` ${followupPublicCount} public followup${followupPublicCount === 1 ? '' : 's'} queued as comments.`;
        }
        if (privateFollowupSkippedCount > 0) {
          summary += ` ${privateFollowupSkippedCount} private followup${privateFollowupSkippedCount === 1 ? '' : 's'} will be skipped.`;
        }
        break;
      case 'executed':
        summary = ref
          ? `Created ${ref} from ${createdTicketLabel}.`
          : `Created task "${title}" from ${createdTicketLabel}.`;
        if (imageTotalCount > 0) {
          summary += ` Imported ${imageImportedCount} of ${imageTotalCount} inline image${imageTotalCount === 1 ? '' : 's'}.`;
        }
        if (followupPublicCount > 0) {
          summary += ` Imported ${followupImportedCount} of ${followupPublicCount} public followup${followupPublicCount === 1 ? '' : 's'} as comments.`;
        }
        if (warningCount > 0) {
          summary += ` ${warningCount} warning${warningCount === 1 ? '' : 's'} recorded during image import.`;
        }
        break;
      case 'rejected':
        summary = isGenericTool
          ? `Ticket import preview for ticket #${ticketId} was rejected.`
          : `GLPI import preview for ticket #${ticketId} was rejected.`;
        break;
      case 'expired':
        summary = isGenericTool
          ? `Ticket import preview for ticket #${ticketId} expired before approval.`
          : `GLPI import preview for ticket #${ticketId} expired before approval.`;
        break;
      case 'failed':
        summary = preview.error_message || (isGenericTool
          ? `Ticket import for ticket #${ticketId} failed.`
          : `GLPI import for ticket #${ticketId} failed.`);
        break;
    }

    return {
      target: buildTarget(preview),
      changes: {
        relation: {
          label: 'Relation',
          from: null,
          to: toDisplayRelation(mutation),
          format: 'text',
        },
        title: {
          label: 'Title',
          from: null,
          to: textOrNull(mutation.title),
          format: 'text',
        },
        requestor: {
          label: 'Requestor',
          from: null,
          to: textOrNull(mutation.requestor_label),
          format: 'text',
        },
        assignee: {
          label: 'Assignee',
          from: null,
          to: assigneeLabel,
          format: 'text',
        },
        priority: {
          label: 'Priority',
          from: null,
          to: priorityLabel,
          format: 'text',
        },
        task_type: {
          label: 'Task Type',
          from: null,
          to: textOrNull(mutation.task_type_label),
          format: 'text',
        },
        source: {
          label: 'Source',
          from: null,
          to: textOrNull(mutation.ticket_source_url ?? mutation.glpi_source_url)
            ? `${isGenericTool ? `Ticket #${ticketId} from ${providerKey}` : `GLPI Ticket #${ticketId}`} (${textOrNull(mutation.ticket_source_url ?? mutation.glpi_source_url)})`
            : isGenericTool ? `Ticket #${ticketId} from ${providerKey}` : `GLPI Ticket #${ticketId}`,
          format: 'text',
        },
        inline_images: {
          label: 'Inline Images',
          from: null,
          to: imageTotalCount > 0 ? `${imageTotalCount} queued for import` : 'None',
          format: 'text',
        },
        followups: {
          label: 'Followups',
          from: null,
          to: followupPublicCount > 0
            ? `${followupPublicCount} public queued as comments${privateFollowupSkippedCount > 0 ? `, ${privateFollowupSkippedCount} private skipped` : ''}`
            : privateFollowupSkippedCount > 0 ? `${privateFollowupSkippedCount} private skipped` : 'None',
          format: 'text',
        },
        followup_inline_images: {
          label: 'Followup Inline Images',
          from: null,
          to: followupImageTotalCount > 0
            ? `${followupImageImportedCount > 0 ? `${followupImageImportedCount} imported of ` : ''}${followupImageTotalCount} queued`
            : 'None',
          format: 'text',
        },
        description: {
          label: 'Description',
          from: null,
          to: textOrNull(mutation.description),
          format: 'markdown',
        },
      },
      summary,
    };
  }

  async executePreview(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
  ): Promise<void> {
    const mutation = preview.mutation_input ?? {};
    const relation = await this.support.resolveStoredCreateTarget(
      context,
      (mutation.relation_type as TicketImportRelationType | undefined) ?? 'standalone',
      (mutation.relation_id as string | null | undefined) ?? null,
    );
    await this.assertRelationAccess(context, relation);

    const providerKey = this.providerKeyForMutation(mutation);
    const ticketId = textOrNull(mutation.ticket_id) ?? textOrNull(mutation.glpi_ticket_id) ?? 'unknown';

    const created = await this.tasks.createForTarget(
      {
        type: relation.type,
        id: relation.id,
        payload: {
          title: textOrNull(mutation.title) ?? undefined,
          description: textOrNull(mutation.description),
          status: 'open',
          assignee_user_id: (mutation.assignee_user_id as string | null | undefined) ?? null,
          priority_level: (mutation.priority_level as TaskPriorityLevel | undefined) ?? 'normal',
          task_type_id: (mutation.task_type_id as string | null | undefined) ?? null,
          creator_id: context.userId,
        },
      },
      context.userId,
      {
        manager: context.manager,
        tenantId: context.tenantId,
        audit: buildAiMutationAudit(preview),
      },
    );

    const rawImageTargets = mutationArray(mutation.ticket_image_targets, mutation.glpi_image_targets);
    const followups = mutationFollowups(mutation.ticket_followups, mutation.glpi_followups);
    const followupImageTargets = followups.flatMap((followup) => followup.image_targets);
    const warnings: string[] = [];
    let importedImageCount = 0;
    let importedFollowupImageCount = 0;
    let importedFollowupCount = 0;
    let followupImageReplacements = new Map<string, string>();

    if (rawImageTargets.length > 0 || followupImageTargets.length > 0) {
      try {
        const tenantSlug = await this.loadCurrentTenantSlug(context);
        const provider = await this.providers.ticketing(context, providerKey);

        if (rawImageTargets.length > 0) {
          const descriptionImages = await this.importInlineImagesForSourceField({
            taskId: created.id,
            context,
            provider,
            ticketId,
            tenantSlug,
            rawTargets: rawImageTargets,
            attachmentRefs: rawImageTargets.map((target): TicketAttachmentRef => ({
              id: null,
              kind: 'image',
              source: 'ticket_description',
              target,
              sourceUri: textOrNull(mutation.ticket_source_url) ?? textOrNull(mutation.glpi_source_url),
            })),
            sourceField: 'description',
          });
          importedImageCount = descriptionImages.importedCount;
          warnings.push(...descriptionImages.warnings);

          if (descriptionImages.replacements.size > 0) {
            try {
              const rewrittenDescription = await rewriteMarkdownImageTargets(
                created.description || textOrNull(mutation.description) || '',
                descriptionImages.replacements,
              );
              if (rewrittenDescription !== (created.description || '')) {
                await this.tasks.updateById(
                  created.id,
                  { description: rewrittenDescription },
                  context.userId,
                  {
                    manager: context.manager,
                    tenantId: context.tenantId,
                    audit: buildAiMutationAudit(preview),
                  },
                );
              }
            } catch (error: any) {
              warnings.push(
                `Failed to rewrite imported ticket images in the task description: ${String(error?.message || error || 'unknown error')}`,
              );
            }
          }
        }

        if (followupImageTargets.length > 0) {
          const followupAttachmentRefs = followups.flatMap((followup) =>
            followup.image_targets.map((target): TicketAttachmentRef => ({
              id: null,
              kind: 'image',
              source: 'ticket_note',
              sourceNoteId: followup.id,
              target,
              sourceUri: null,
            })),
          );
          const followupImages = await this.importInlineImagesForSourceField({
            taskId: created.id,
            context,
            provider,
            ticketId,
            tenantSlug,
            rawTargets: followupImageTargets,
            attachmentRefs: followupAttachmentRefs,
            sourceField: 'content',
          });
          followupImageReplacements = followupImages.replacements;
          importedFollowupImageCount = followupImages.importedCount;
          warnings.push(...followupImages.warnings);
        }
      } catch (error: any) {
        warnings.push(
          `Ticket inline image import did not complete: ${String(error?.message || error || 'unknown error')}`,
        );
      }
    }

    // The follow-up texts are converted in the Markdown workers, within one time budget.
    const followupBudget = markdownWorkBudget();
    for (const followup of followups) {
      try {
        assertMarkdownSize(followup.content_html, 'content');
        const normalizedContentHtml = textOrNull(
          await resolveHtmlContentSource(followup.content_html || '', { budget: followupBudget }),
        );
        const converted = await htmlToMarkdown(normalizedContentHtml || '', { budget: followupBudget });
        const rewritten = followupImageReplacements.size > 0
          ? await rewriteMarkdownImageTargets(converted, followupImageReplacements, followupBudget)
          : converted;
        const content = buildImportedFollowupComment(this.sourceLabels(providerKey).sourceLabel, ticketId, followup, rewritten);
        await this.activities.createImportedComment(
          created.id,
          {
            content,
            context: this.importedCommentContext(mutation),
            created_at: parseProviderDate(followup.date),
          },
          context.tenantId,
          context.userId,
          {
            manager: context.manager,
            audit: buildAiMutationAudit(preview),
          },
        );
        importedFollowupCount += 1;
      } catch (error: any) {
        warnings.push(
          `Failed to import ticket followup #${followup.id}: ${String(error?.message || error || 'unknown error')}`,
        );
      }
    }

    preview.target_entity_id = created.id;
    preview.current_values = {
      ...(preview.current_values ?? {}),
      target_ref: created.item_number ? `T-${created.item_number}` : null,
      target_title: created.title ?? textOrNull(mutation.title),
      ticket_provider_kind: 'ticketing',
      ticket_provider_key: providerKey,
      ticket_id: ticketId,
      ticket_image_total_count: rawImageTargets.length,
      ticket_image_imported_count: importedImageCount,
      ticket_followup_public_count: followups.length,
      ticket_followup_imported_count: importedFollowupCount,
      ticket_followup_private_skipped_count: Number(mutation.ticket_followup_private_skipped_count ?? mutation.glpi_followup_private_skipped_count ?? 0),
      ticket_followup_image_total_count: followupImageTargets.length,
      ticket_followup_image_imported_count: importedFollowupImageCount,
      ticket_image_warnings: warnings,
      ...(providerKey === LEGACY_GLPI_TICKETING_PROVIDER_KEY ? {
        glpi_image_total_count: rawImageTargets.length,
        glpi_image_imported_count: importedImageCount,
        glpi_followup_public_count: followups.length,
        glpi_followup_imported_count: importedFollowupCount,
        glpi_followup_private_skipped_count: Number(mutation.ticket_followup_private_skipped_count ?? mutation.glpi_followup_private_skipped_count ?? 0),
        glpi_followup_image_total_count: followupImageTargets.length,
        glpi_followup_image_imported_count: importedFollowupImageCount,
        glpi_image_warnings: warnings,
      } : {}),
    };
  }
}

@Injectable()
export class ImportGlpiTicketAiMutationOperation extends BaseImportTicketAiMutationOperation<LegacyImportTicketInput> {
  constructor(
    support: AiTaskMutationSupportService,
    tasks: TasksUnifiedService,
    attachments: TaskAttachmentsService,
    activities: TaskActivitiesService,
    providers: AiProviderRegistryService,
    policy: AiPolicyService,
  ) {
    super(support, tasks, attachments, activities, providers, policy);
  }
}

@Injectable()
export class ImportTicketAiMutationOperation extends BaseImportTicketAiMutationOperation<ImportTicketInput> implements AiMutationOperation<ImportTicketInput> {
  readonly toolName: AiMutationWriteToolName = 'import_ticket';
  readonly description: string = 'Create a preview to import one ticket from a configured ticketing provider into one KANAP task. Requires explicit user approval before execution.';
  readonly inputSchema: z.ZodTypeAny = ImportTicketInputSchema;
  readonly inputSummary: Record<string, string> = {
    provider_key: 'Configured ticketing provider key.',
    ticket_id: 'Ticket identifier in the selected provider.',
    relation_type: 'Optional relation type: project, spend_item, capex_item, or standalone.',
    relation_ref: 'Optional relation target reference. Required when relation_type is project, spend_item, or capex_item.',
    assignee: 'Optional assignee email, full name, or unique user label in the current tenant.',
    priority_level: 'Optional task priority override. Defaults to the provider priority mapping.',
    priority: 'Alias for priority_level.',
  };
  readonly writePreview: AiWritePreviewCapabilityDto = {
    entity_type: 'tasks',
    fields: ['relation', 'title', 'description', 'assignee', 'priority_level', 'task_type', 'source', 'comments'],
    reversible: false,
    prompt_hint: 'For ticket escalation, use `import_ticket` with `provider_key` and `ticket_id`. The task requestor is always the current Plaid user.',
  };

  constructor(
    support: AiTaskMutationSupportService,
    tasks: TasksUnifiedService,
    attachments: TaskAttachmentsService,
    activities: TaskActivitiesService,
    providers: AiProviderRegistryService,
    policy: AiPolicyService,
  ) {
    super(support, tasks, attachments, activities, providers, policy);
  }

  protected providerKeyForInput(input: LegacyImportTicketInput | ImportTicketInput): string {
    const providerKey = textOrNull((input as ImportTicketInput).provider_key);
    if (!providerKey) {
      throw new BadRequestException('provider_key is required for import_ticket.');
    }
    return providerKey;
  }

  protected providerKeyForMutation(mutation: Record<string, unknown>): string {
    const providerKey = textOrNull(mutation.ticket_provider_key) ?? textOrNull(mutation.provider_key);
    if (!providerKey) {
      throw new BadRequestException('ticket_provider_key is required for stored import_ticket previews.');
    }
    return providerKey;
  }

  protected importedCommentContext(_mutation: Record<string, unknown>): string {
    return 'ticket_import';
  }
}
