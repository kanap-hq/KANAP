import { BadRequestException, Injectable } from '@nestjs/common';
import type { CsvLanguage } from '../../common/csv-sheet';
import { assertUnscopedDataAccess } from '../../data-access/reserved-operations';
import type { CatalogOptionLike } from '../../it-ops-settings/catalog-resolve';
import { shippedLabelIn, withShippedLabels } from '../../it-ops-settings/catalog-shipped-labels';
import { ItOpsSettings, ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { AiAttachmentService } from '../ai-attachment.service';
import { AiPolicyService } from '../ai-policy.service';
import type { AiExecutionContextWithManager, AiImportMappingPreviewDto, AiImportRunDto } from '../ai.types';
import { readTableAttachment, TABLE_ATTACHMENT_KIND } from '../attachments/table-attachment';
import { AI_IMPORT_KEYS, AI_IMPORT_WHOLE_ROWS, aiImportAccess, type AiImportKey } from './ai-import-access';
import { buildImportFile } from './ai-import-file';
import { AiImportColumnMappingInput, AiImportMappingResult, AiImportTemplateColumn, buildImportMapping } from './ai-import-mapping';
import { AiImportRunnerService } from './ai-import-runner.service';
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

/** The code of a file refused because its import would clear columns of the records it updates. */
export const AI_IMPORT_CLEARS_COLUMNS = 'AI_IMPORT_CLEARS_COLUMNS';

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
 * Plaid's side of an import (lots I2 and I3): the template of each import, the mapping of an attached
 * spreadsheet onto it, and the import of the file the mapping builds, checked then loaded by the
 * import of the screen. The file is read here, on the server, by its attachment id: the model works
 * from the file's summary and the template, and receives counts back, never other cells.
 */
@Injectable()
export class AiImportMappingService {
  constructor(
    private readonly attachments: AiAttachmentService,
    private readonly itOpsSettings: ItOpsSettingsService,
    private readonly policy: AiPolicyService,
    private readonly runner: AiImportRunnerService,
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
   * The mapping of an attached spreadsheet onto an import, and the import's check of the file it
   * builds (its dry run): the file, read again from its attachment (a spreadsheet of this
   * conversation, attached by the person), converted row by row.
   */
  async prepareMapping(
    context: AiExecutionContextWithManager,
    input: PrepareImportMappingInput,
    language: CsvLanguage,
  ): Promise<{ target: AiImportTarget; mapping: AiImportMappingPreviewDto }> {
    const target = aiImportTarget(input.entity_type);
    const { converted, lines, left } = await this.convert(context, target, input, language);
    const validation = await this.runner.run(target.key, buildImportFile(converted.file, language), { dryRun: true, language, lines }, context);
    return { target, mapping: { ...converted.preview, validation: refuseClearedColumns(validation, left) } };
  }

  /**
   * The import of an approved mapping: the file converted again with the same mapping, then loaded by
   * the import, which checks it once more and writes nothing when it refuses a row.
   */
  async runImport(
    context: AiExecutionContextWithManager,
    input: PrepareImportMappingInput,
    language: CsvLanguage,
  ): Promise<AiImportRunDto> {
    const target = aiImportTarget(input.entity_type);
    const { converted, lines, left } = await this.convert(context, target, input, language);
    // Refused after the load as well: the approval's savepoint undoes it, and the card says why.
    const result = await this.runner.run(target.key, buildImportFile(converted.file, language), { dryRun: false, language, lines }, context);
    return refuseClearedColumns(result, left);
  }

  private async convert(
    context: AiExecutionContextWithManager,
    target: AiImportTarget,
    input: PrepareImportMappingInput,
    language: CsvLanguage,
  ): Promise<{ converted: AiImportMappingResult; lines: number[]; left: AiImportTemplateColumn[] }> {
    const attachment = await this.assertTableAttachment(context, input.attachment_id);
    const { buffer } = await this.attachments.loadAttachmentBuffer(attachment.id, context.tenantId, context.manager);
    const grid = await readTableAttachment(buffer);
    const { columns } = await this.templateColumns(context, target, language);
    const converted = buildImportMapping(grid, columns, {
      importKey: target.key,
      filename: attachment.original_filename,
      columns: input.columns,
      assumptions: input.assumptions ?? [],
    }, language);
    // An import that reads every column of its template gets them all: the ones the mapping leaves out, blank.
    const mapped = new Set(converted.file.columns.map((column) => column.column));
    const left = AI_IMPORT_WHOLE_ROWS.has(target.key) ? columns.filter((column) => !mapped.has(column.column)) : [];
    for (const column of left) {
      converted.file.columns.push({ column: column.column, kind: column.kind });
      for (const row of converted.file.rows) row.push('');
    }
    return { converted, lines: grid.lines, left };
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

/**
 * An import that replaces every value of a record it updates clears the template's columns the file
 * lacks: a file without some of them is refused when it would update existing records, whose values in
 * those columns would be lost. A file of new records only, or of every column, imports as on the screen.
 */
export function refuseClearedColumns(run: AiImportRunDto, left: readonly AiImportTemplateColumn[]): AiImportRunDto {
  if (left.length === 0 || run.updated === 0 || run.report.kind !== 'rows') return run;
  const columns = left.map((column) => column.title).join(', ');
  const error = {
    row: 0,
    message: (run.updated === 1
      ? '1 row updates an existing record, and this import replaces all its values'
      : `${run.updated} rows update existing records, and this import replaces all their values`)
      + `: the file has no column for ${columns}, whose values would be cleared. Map those columns, or keep only new records in the file.`,
    code: AI_IMPORT_CLEARS_COLUMNS,
    params: { count: run.updated, columns },
  };
  return {
    ...run,
    ok: false,
    error_count: run.error_count + 1,
    issues: [{ level: 'error', code: AI_IMPORT_CLEARS_COLUMNS, column: null, count: run.updated }, ...run.issues],
    report: { ...run.report, errors: [error, ...run.report.errors] },
  };
}
