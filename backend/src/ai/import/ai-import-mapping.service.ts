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
import { DESCRIBED_CATALOG_ENTRIES, enabledDimensionValues } from './ai-import-dimension-values';
import { buildImportFile } from './ai-import-file';
import { AiImportColumnMappingInput, AiImportMappingResult, AiImportTemplateColumn, buildImportMapping } from './ai-import-mapping';
import { AiImportRunnerService, rowsApprovalFacts } from './ai-import-runner.service';
import { AI_IMPORT_TARGETS, AiImportColumnSpec, AiImportTarget, importColumnTitle } from './ai-import-targets';
import { cellKey } from '../../spend/budget-file/matching';
import type { BudgetFileChoice, BudgetFileMatch } from '../../spend/budget-file/types';

export type PrepareImportMappingInput = {
  attachment_id: string;
  entity_type: AiImportKey;
  columns: AiImportColumnMappingInput[];
  assumptions?: string[];
  /**
   * The person's choices on the card (a budget file: matches undone, "Create missing suppliers"),
   * set by the server, never by the model: the tool's input schema has no such field.
   */
  choices?: BudgetFileChoice[];
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
  /** The workspace's entries of a catalog column, or a fixed list's codes, by code and name in the person's language. */
  entries?: Array<{ code: string; name: string }>;
  /** A budget file's dimension column: the dimension's enabled values, by name (the first ones). */
  values?: string[];
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
 * from the file's summary (first rows, distinct values) and the template, and receives the check's
 * counts, issues and matching back; the server checks every row.
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
    const dimensionValues = target.key === 'budget_lines' ? await enabledDimensionValues(context) : new Map<string, string[]>();
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
        // A fixed list the screens name: each code with its name in the person's language.
        ...(column.kind === 'codes' && column.displayName
          ? { entries: (column.codes ?? []).map((code) => ({ code, name: column.displayName!(code) })) }
          : {}),
        ...(column.kind === 'catalog' ? {
          entries: (column.options ?? [])
            .filter((option) => !option.deprecated)
            .slice(0, DESCRIBED_CATALOG_ENTRIES)
            .map((option) => ({ code: option.code, name: column.displayName?.(option.code) ?? option.label ?? option.code })),
        } : {}),
        ...(dimensionValues.has(column.column) ? { values: dimensionValues.get(column.column) } : {}),
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
    const validation = await this.runner.run(target.key, buildImportFile(converted.file, language), {
      dryRun: true, language, lines, matching: { choices: input.choices ?? [], proposals: converted.file.proposals },
    }, context);
    // The facts of the approval lead the card the model reads: the budget file's, or the counts of a
    // row import, once a file that would clear columns is refused.
    const { on_approval: budgetFacts, ...checked } = refuseClearedColumns(validation, left);
    const onApproval = budgetFacts ?? (checked.report.kind === 'rows' ? rowsApprovalFacts(checked) : undefined);
    return { target, mapping: { ...(onApproval ? { on_approval: onApproval } : {}), ...converted.preview, validation: checked } };
  }

  /**
   * The file a mapping builds, as the import reads it, for the person to download from the card: with
   * the same rights as the card, converted again from the attachment, every template column of an
   * import that reads them all included. A budget file holds the values the card's check matched
   * (the ones the person did not undo), as the import's dialog will read them.
   */
  async preparedFile(
    context: AiExecutionContextWithManager,
    input: PrepareImportMappingInput,
    language: CsvLanguage,
  ): Promise<{ content: Buffer; rows: number }> {
    const target = aiImportTarget(input.entity_type);
    await this.assertImportRights(context, target);
    const { converted, lines } = await this.convert(context, target, input, language);
    if (target.key === 'budget_lines') {
      const check = await this.runner.run(target.key, buildImportFile(converted.file, language), {
        dryRun: true, language, lines, matching: { choices: input.choices ?? [], proposals: converted.file.proposals },
      }, context);
      const file = check.report.kind === 'budget_file' ? check.report.file : null;
      writeMatches(converted.file, ((file?.matching as { matches?: BudgetFileMatch[] } | undefined)?.matches) ?? []);
    }
    return { content: buildImportFile(converted.file, language), rows: converted.file.rows.length };
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
    const result = await this.runner.run(target.key, buildImportFile(converted.file, language), {
      dryRun: false, language, lines, matching: { choices: input.choices ?? [], proposals: converted.file.proposals },
    }, context);
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
 * Writes the matched values in the file: each cell of a matched column whose value the check matched
 * holds the existing value it stands for. The matches' `value` is the file's cell, case aside.
 */
function writeMatches(file: AiImportMappingResult['file'], matches: readonly BudgetFileMatch[]): void {
  if (matches.length === 0) return;
  const byKey = new Map(matches.map((match) => [cellKey(match.column, match.value), match.target]));
  file.columns.forEach((column, index) => {
    for (const row of file.rows) {
      const cell = row[index];
      if (typeof cell !== 'string' || cell === '') continue;
      const target = byKey.get(cellKey(column.column, cell));
      if (target !== undefined) row[index] = target;
    }
  });
  delete file.proposals;
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
