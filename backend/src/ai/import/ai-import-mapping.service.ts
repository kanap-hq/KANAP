import { BadRequestException, Injectable } from '@nestjs/common';
import type { CsvLanguage } from '../../common/csv-sheet';
import { assertUnscopedDataAccess } from '../../data-access/reserved-operations';
import type { CatalogOptionLike } from '../../it-ops-settings/catalog-resolve';
import { shippedLabelIn, withShippedLabels } from '../../it-ops-settings/catalog-shipped-labels';
import { ItOpsSettings, ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { AiAttachmentService } from '../ai-attachment.service';
import { AiPolicyService } from '../ai-policy.service';
import type { AiExecutionContextWithManager, AiImportMappingPreviewDto } from '../ai.types';
import { readTableAttachment, TABLE_ATTACHMENT_KIND } from '../attachments/table-attachment';
import { AI_IMPORT_KEYS, aiImportAccess, type AiImportKey } from './ai-import-access';
import { AiImportColumnMappingInput, AiImportTemplateColumn, buildImportMapping } from './ai-import-mapping';
import { AI_IMPORT_TARGETS, AiImportColumnSpec, AiImportTarget, importColumnTitle } from './ai-import-targets';

/** Catalog entries the template description lists for a column. */
const DESCRIBED_CATALOG_ENTRIES = 60;

export type PrepareImportMappingInput = {
  attachment_id: string;
  entity_type: AiImportKey;
  columns: AiImportColumnMappingInput[];
  assumptions?: string[];
};

/** One column of an import's template, as `describe_import_template` gives it to the model. */
export type AiImportTemplateColumnDto = {
  column: string;
  title: string;
  required: boolean;
  kind: string;
  multi?: boolean;
  takes?: string;
  codes?: readonly string[];
  /** The workspace's entries of a catalog column, by code and name. */
  entries?: Array<{ code: string; name: string }>;
};

/** An import named by its key, or a refusal that lists the imports. */
export function aiImportTarget(key: unknown): AiImportTarget {
  if (!aiImportAccess(key)) {
    throw new BadRequestException(`Unknown import "${String(key ?? '')}". The imports are: ${AI_IMPORT_KEYS.join(', ')}.`);
  }
  return AI_IMPORT_TARGETS[String(key).trim() as AiImportKey];
}

function templateColumn(spec: AiImportColumnSpec, settings: ItOpsSettings | null, language: CsvLanguage): AiImportTemplateColumn {
  const base = {
    column: spec.column,
    title: importColumnTitle(spec, language),
    required: spec.required === true,
    kind: spec.kind,
    multi: spec.multi === true,
    percent: spec.percent === true,
  };
  if (spec.kind === 'catalog' && spec.catalog && settings) {
    const list = spec.catalog;
    const options = ((settings as unknown as Record<string, unknown>)[list] ?? []) as CatalogOptionLike[];
    return {
      ...base,
      options,
      displayName: (code) => {
        const option = options.find((entry) => entry.code === code);
        return option ? shippedLabelIn(list, option, language) ?? (option.label || code) : code;
      },
    };
  }
  if (spec.kind === 'codes') {
    const labels = spec.labels;
    return {
      ...base,
      codes: spec.codes,
      ...(labels ? {
        codeLabels: Object.fromEntries((spec.codes ?? []).map((code) => [
          code,
          [...new Set(Object.values(labels).map((names) => names[code]).filter((name): name is string => !!name))],
        ])),
        displayName: (code: string) => labels[language]?.[code] ?? code,
      } : {}),
    };
  }
  return base;
}

/**
 * Plaid's side of an import (lot I2): the template of each import, and the mapping of an attached
 * spreadsheet onto it. The file is read here, on the server, by its attachment id: the model works
 * from the file's summary and the template, and receives counts back, never other cells.
 */
@Injectable()
export class AiImportMappingService {
  constructor(
    private readonly attachments: AiAttachmentService,
    private readonly itOpsSettings: ItOpsSettingsService,
    private readonly policy: AiPolicyService,
  ) {}

  /**
   * The rights of the import route, for the template description: the module at its level, the
   * module the route also reads, and the reservation to unscoped persons. The preview checks them
   * again (`ai-write-levels.ts`, `ai-mutation-reserved.ts`).
   */
  async assertImportRights(context: AiExecutionContextWithManager, target: AiImportTarget): Promise<void> {
    await this.policy.assertWriteAccess(context, target.resource, context.manager, { level: target.level });
    if (target.alsoReads) await this.policy.assertBusinessPermission(context, target.alsoReads, 'reader', context.manager);
    if (target.reservedToUnscoped) await assertUnscopedDataAccess({ manager: context.manager, userId: context.userId });
  }

  /** The template's columns, as the mapping converts them, titled in the person's language. */
  async templateColumns(
    context: AiExecutionContextWithManager,
    target: AiImportTarget,
    language: CsvLanguage,
  ): Promise<{ specs: AiImportColumnSpec[]; columns: AiImportTemplateColumn[] }> {
    const specs = await target.columns({ manager: context.manager, tenantId: context.tenantId });
    const settings = specs.some((spec) => spec.kind === 'catalog')
      ? withShippedLabels(await this.itOpsSettings.getSettings(context.tenantId, { manager: context.manager }))
      : null;
    return { specs, columns: specs.map((spec) => templateColumn(spec, settings, language)) };
  }

  async describeTemplate(
    context: AiExecutionContextWithManager,
    key: unknown,
    language: CsvLanguage,
  ): Promise<{ import: AiImportKey; name: string; about: string; columns: AiImportTemplateColumnDto[] }> {
    const target = aiImportTarget(key);
    await this.assertImportRights(context, target);
    const { specs, columns } = await this.templateColumns(context, target, language);
    return {
      import: target.key,
      name: target.names[language],
      about: target.about,
      columns: columns.map((column, index) => ({
        column: column.column,
        title: column.title,
        required: column.required,
        kind: column.kind,
        ...(column.multi ? { multi: true } : {}),
        ...(specs[index].hint ? { takes: specs[index].hint } : {}),
        ...(column.kind === 'codes' ? { codes: column.codes ?? [] } : {}),
        ...(column.kind === 'catalog' ? {
          entries: (column.options ?? [])
            .filter((option) => !option.deprecated)
            .slice(0, DESCRIBED_CATALOG_ENTRIES)
            .map((option) => ({ code: option.code, name: column.displayName?.(option.code) ?? option.label ?? option.code })),
        } : {}),
      })),
    };
  }

  /**
   * The mapping of an attached spreadsheet onto an import: the file, read again from its attachment
   * (a spreadsheet of this conversation, attached by the person), converted row by row.
   */
  async prepareMapping(
    context: AiExecutionContextWithManager,
    input: PrepareImportMappingInput,
    language: CsvLanguage,
  ): Promise<{ target: AiImportTarget; mapping: AiImportMappingPreviewDto }> {
    const target = aiImportTarget(input.entity_type);
    const attachment = await this.assertTableAttachment(context, input.attachment_id);
    const { buffer } = await this.attachments.loadAttachmentBuffer(attachment.id, context.tenantId, context.manager);
    const grid = await readTableAttachment(buffer);
    const { columns } = await this.templateColumns(context, target, language);
    const { preview } = buildImportMapping(grid, columns, {
      importKey: target.key,
      filename: attachment.original_filename,
      columns: input.columns,
      assumptions: input.assumptions ?? [],
    }, language);
    return { target, mapping: preview };
  }

  /** The spreadsheet of this conversation the person attached, or a refusal. */
  async assertTableAttachment(context: AiExecutionContextWithManager, attachmentId: string) {
    if (!context.conversationId) {
      throw new BadRequestException('A spreadsheet is mapped in the conversation it was attached to.');
    }
    const [attachment] = await this.attachments.assertAndLoadAttachments([attachmentId], {
      conversationId: context.conversationId,
      tenantId: context.tenantId,
      userId: context.userId,
    }, context.manager);
    if (attachment.kind !== TABLE_ATTACHMENT_KIND) {
      throw new BadRequestException('This attachment is not a spreadsheet: the mapping reads a CSV or Excel file attached to the conversation.');
    }
    return attachment;
  }
}
