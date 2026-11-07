import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { writeAuditLog } from '../../../audit/audit.service';
import { IMPORT_EVENT_ACTION, IMPORT_EVENT_TABLE } from '../../../audit/security-events';
import { AiMutationPreview } from '../../ai-mutation-preview.entity';
import { AiExecutionContextWithManager, AiImportMappingPreviewDto } from '../../ai.types';
import {
  AiWriteLanguage,
  importCountsText,
  personWriteLanguage,
  PREVIEW_IMPORT_REFUSED_MESSAGE,
  previewSummaryText,
  writeActionText,
} from '../../ai-write-texts';
import { AI_IMPORT_KEYS, AI_IMPORT_RESOURCES, aiImportAccess } from '../../import/ai-import-access';
import { AiImportMappingService, aiImportTarget, PrepareImportMappingInput } from '../../import/ai-import-mapping.service';
import { AI_IMPORT_TARGETS } from '../../import/ai-import-targets';
import { buildAiMutationAudit } from '../ai-mutation-audit.util';
import { AiMutationOperation, AiMutationPreviewPresentation, AiPreparedMutationPreview } from '../ai-mutation-operation.types';

const ColumnMappingSchema = z.object({
  column: z.string().trim().min(1).max(80)
    .describe('A column of the import template, as describe_import_template names it (`go_live_date`).'),
  source: z.number().int().min(1).nullable().optional()
    .describe('The file column it reads: its position, as the summary numbers the columns.'),
  value: z.string().trim().max(200).nullable().optional()
    .describe('Instead of a source: one value for every row, when the file holds none (the nature of every budget line).'),
  confidence: z.enum(['high', 'medium', 'low'])
    .describe('high: the header and the values say it; medium: the values fit, the header is unclear; low: a guess.'),
  date_order: z.enum(['day-first', 'month-first']).optional()
    .describe('For a date column written like 03/04/2026, when the first rows show the order. Else the file settles it.'),
  decimal_mark: z.enum([',', '.']).optional()
    .describe('For a number column written as text, when the first rows show the decimal mark. Else the file settles it.'),
  values: z.record(z.string(), z.string().trim().max(200)).optional()
    .describe('A value of the file and the value it stands for, for the values the column does not read by itself: a code or catalog name '
      + '({"Prod": "Production"}), a number ({"3 months": "3"}), a person\'s e-mail, a name as the workspace writes it; "" leaves the cell blank.'),
  note: z.string().trim().max(200).nullable().optional()
    .describe('What you supposed for this column, in the person\'s language, when it is not obvious.'),
});

const PrepareImportMappingInputSchema = z.object({
  attachment_id: z.string().uuid()
    .describe('The id of the attached spreadsheet, from its `<attached_table id="...">` summary.'),
  entity_type: z.enum(AI_IMPORT_KEYS)
    .describe('The import the file fills.'),
  columns: z.array(ColumnMappingSchema).min(1).max(150)
    .describe('One entry per template column the file fills, in any order. A template column left out stays empty.'),
  assumptions: z.array(z.string().trim().min(1).max(300)).max(12).optional()
    .describe('What the mapping supposes about the whole file, in the person\'s language (one row per server, the amounts are in euros).'),
});

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * The import of an attached spreadsheet, in two steps as on the import screen (lots I2 and I3 of
 * the Plaid import). The model proposes the mapping of the file's columns onto the import's
 * template; the server reads the whole file again, converts every row, builds the file in the
 * template's format and has the import check it (its dry run), and the card shows the first rows,
 * the values not read and the check. Approving runs the import on the same file, with the person's
 * rights, and the card shows what it did.
 */
@Injectable()
export class PrepareImportMappingAiMutationOperation implements AiMutationOperation<PrepareImportMappingInput> {
  readonly toolName = 'prepare_import_mapping' as const;
  readonly description = 'Create a preview of how a spreadsheet the user attached maps onto the template of a KANAP import: '
    + 'one entry per template column, with the file column it reads (or one value for every row) and your confidence. '
    + 'Call describe_import_template first for the template\'s columns. The server reads the whole file, converts every row '
    + '(dates and times, numbers, yes/no, codes, catalog names and countries by name) and returns, per column, the values read and not read; '
    + 'the card shows the user the first rows and the values it could not read. To correct the mapping, call it again with the corrected mapping. '
    + 'The server also has the import check the file it builds (its dry run): the result gives the counts (rows to create, update, '
    + 'unchanged) and, per code and column, the number of errors and warnings; the card shows the person the messages. '
    + 'Requires explicit user approval. Approving runs the import with the user\'s rights; a card whose check found errors cannot be approved.';
  readonly inputSchema = PrepareImportMappingInputSchema;
  readonly inputSummary = {
    attachment_id: 'The id of the attached spreadsheet, from its `<attached_table id="...">` summary.',
    entity_type: `The import the file fills: ${AI_IMPORT_KEYS.join(', ')}.`,
    columns: 'One entry per template column the file fills: column, source (file column position) or value (for every row), confidence, and optionally date_order, decimal_mark, values (file value to the value it stands for) and note.',
    assumptions: 'What the mapping supposes about the whole file, in the user\'s language.',
  };
  readonly businessResource = 'applications';
  readonly businessResources = AI_IMPORT_RESOURCES;
  readonly writePreview = {
    entity_type: 'imports',
    fields: ['column_mapping'],
    reversible: false,
    prompt_hint: 'For a spreadsheet the user attached (an `<attached_table>` in their message) that they want imported, or that fits a KANAP import: '
      + 'call `describe_import_template` for the import it fits, then `prepare_import_mapping` with the attachment id and the mapping. '
      + 'Map a column only when its header or its first rows say what it holds; say what you supposed in `note` or `assumptions`, '
      + 'and name the file columns you leave out. When the card shows values not read, ask the user what they stand for and call again with `values`. '
      + 'References to other records (a company, a supplier, a server, a person) are copied as written: the import checks them when it runs, '
      + 'and neither you nor the card has checked them. '
      + 'A new card for the same file closes the pending one at once: it can no longer be approved, so do not warn the person about it. '
      + 'The card also shows the import\'s check of the file. When it finds errors, the card cannot be approved: say what the errors are about '
      + '(their columns and codes, never the cells), help the user correct the mapping or the file, and call again. '
      + 'The imports of master data and technology links replace every value of a record they update: when the check refuses the file '
      + 'with AI_IMPORT_CLEARS_COLUMNS, rows of the file match existing records and the template columns it lacks would be cleared; '
      + 'offer to map those columns or to keep only the new records. '
      + 'Approving the card runs the import, and its card then shows what was created and updated: until then nothing is imported, '
      + 'so never say it is.',
  };

  constructor(private readonly mapping: AiImportMappingService) {}

  resolveBusinessResource(params: { input?: PrepareImportMappingInput; preview?: AiMutationPreview }): string {
    const key = params.input?.entity_type ?? params.preview?.mutation_input?.entity_type;
    return aiImportTarget(key).resource;
  }

  resolveWriteFamily(params: { input?: PrepareImportMappingInput; preview?: AiMutationPreview }): string {
    return String(params.input?.entity_type ?? params.preview?.mutation_input?.entity_type ?? '');
  }

  async prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: PrepareImportMappingInput,
  ): Promise<AiPreparedMutationPreview> {
    const language = await personWriteLanguage(context.manager, context.tenantId, context.userId);
    const { target, mapping } = await this.mapping.prepareMapping(context, input, language);
    return {
      // The import as the target type: the reservation of the import route is checked on it again at approval.
      targetEntityType: target.key,
      targetEntityId: null,
      mutationInput: {
        entity_type: target.key,
        attachment_id: input.attachment_id,
        filename: mapping.filename,
        columns: input.columns,
        assumptions: input.assumptions ?? [],
      },
      currentValues: { import_mapping: mapping },
    };
  }

  /** A new mapping of the same file replaces the pending one: the person has one card to approve. */
  replacesPendingPreview(pending: AiMutationPreview, replacement: AiMutationPreview): boolean {
    return pending.mutation_input?.attachment_id === replacement.mutation_input?.attachment_id;
  }

  presentPreview(preview: AiMutationPreview, language: AiWriteLanguage = 'en'): AiMutationPreviewPresentation {
    const mutation = preview.mutation_input ?? {};
    const key = stringOf(mutation.entity_type);
    const target = aiImportAccess(key) ? AI_IMPORT_TARGETS[key as keyof typeof AI_IMPORT_TARGETS] : null;
    const list = target?.names[language] ?? key;
    const filename = stringOf(mutation.filename);
    const mapping = (preview.current_values?.import_mapping ?? null) as AiImportMappingPreviewDto | null;
    const counts = mapping?.result ? importCountsText(language, mapping.result) : '';

    let summary: string;
    if (language === 'en') {
      switch (preview.status) {
        case 'pending': summary = `Import "${filename}" into the ${list} list.`; break;
        case 'executed': summary = `"${filename}" imported into the ${list} list.${counts ? ` ${counts}` : ''}`; break;
        case 'rejected': summary = `Import of "${filename}" into the ${list} list rejected.`; break;
        case 'expired': summary = `Import of "${filename}" into the ${list} list expired before approval.`; break;
        case 'failed': summary = preview.error_message || `Import of "${filename}" into the ${list} list failed.`; break;
        default: summary = `Preview ${preview.id} ${preview.status}.`;
      }
    } else {
      summary = previewSummaryText(language, preview.status, writeActionText.importFile(language, filename, list), {
        executed: counts ? [counts] : [],
        errorMessage: preview.error_message,
      });
    }

    return {
      target: {
        entity_type: 'imports',
        entity_id: null,
        ref: null,
        title: filename ? `${list} · ${filename}` : list,
      },
      changes: {},
      summary,
      ...(mapping ? { importMapping: mapping } : {}),
    };
  }

  /**
   * Runs the import on the file of the approved mapping, built again from the attachment (still the
   * person's spreadsheet of this conversation). A card whose check found errors is refused, and so is
   * a file the import refuses now: nothing is written. The card keeps what the import did, and the
   * audit log records the import as made through Plaid.
   */
  async executePreview(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
  ): Promise<void> {
    const mapping = (preview.current_values?.import_mapping ?? null) as AiImportMappingPreviewDto | null;
    if (!mapping?.validation?.ok) throw new Error(PREVIEW_IMPORT_REFUSED_MESSAGE);
    const input = preview.mutation_input as unknown as PrepareImportMappingInput;
    const language = await personWriteLanguage(context.manager, context.tenantId, context.userId);
    const result = await this.mapping.runImport(
      { ...context, conversationId: context.conversationId ?? preview.conversation_id ?? null },
      input,
      language,
    );
    if (!result.ok) throw new Error(PREVIEW_IMPORT_REFUSED_MESSAGE);

    preview.current_values = { ...preview.current_values, import_mapping: { ...mapping, result } };
    await writeAuditLog(context.manager, {
      table: IMPORT_EVENT_TABLE,
      recordId: null,
      action: IMPORT_EVENT_ACTION,
      before: null,
      after: {
        list: input.entity_type,
        filename: stringOf(preview.mutation_input?.filename),
        rows: result.total,
        inserted: result.inserted,
        updated: result.updated,
        unchanged: result.unchanged,
      },
      userId: context.userId,
      ...buildAiMutationAudit(preview),
    });
  }
}
