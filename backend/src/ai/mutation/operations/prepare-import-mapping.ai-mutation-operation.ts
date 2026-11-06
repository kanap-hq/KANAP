import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AiMutationPreview } from '../../ai-mutation-preview.entity';
import { AiExecutionContextWithManager, AiImportMappingPreviewDto } from '../../ai.types';
import {
  AiWriteLanguage,
  importMappingNothingImportedText,
  personWriteLanguage,
  previewSummaryText,
  writeActionText,
} from '../../ai-write-texts';
import { AI_IMPORT_KEYS, AI_IMPORT_RESOURCES, aiImportAccess } from '../../import/ai-import-access';
import { AiImportMappingService, aiImportTarget, PrepareImportMappingInput } from '../../import/ai-import-mapping.service';
import { AI_IMPORT_TARGETS } from '../../import/ai-import-targets';
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
    .describe('A value of the file and the code or catalog name it stands for, for the values names do not settle ({"Prod": "Production"}).'),
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
 * The column mapping of an attached spreadsheet onto an import's template (lot I2 of the Plaid
 * import): the model proposes the mapping from the file's summary and the template; the server
 * reads the whole file again, converts every row and shows the result on the card. Approving
 * records the mapping and writes nothing: the import itself comes with its dry run (lot I3).
 */
@Injectable()
export class PrepareImportMappingAiMutationOperation implements AiMutationOperation<PrepareImportMappingInput> {
  readonly toolName = 'prepare_import_mapping' as const;
  readonly description = 'Create a preview of how a spreadsheet the user attached maps onto the template of a KANAP import: '
    + 'one entry per template column, with the file column it reads (or one value for every row) and your confidence. '
    + 'Call describe_import_template first for the template\'s columns. The server reads the whole file, converts every row '
    + '(dates, numbers, yes/no, codes and catalog names by name) and returns, per column, the values read and not read; '
    + 'the card shows the user the first rows and the values it could not read. To correct the mapping, call it again with the corrected mapping. '
    + 'Requires explicit user approval. Approving records the mapping: nothing is imported yet.';
  readonly inputSchema = PrepareImportMappingInputSchema;
  readonly inputSummary = {
    attachment_id: 'The id of the attached spreadsheet, from its `<attached_table id="...">` summary.',
    entity_type: `The import the file fills: ${AI_IMPORT_KEYS.join(', ')}.`,
    columns: 'One entry per template column the file fills: column, source (file column position) or value (for every row), confidence, and optionally date_order, decimal_mark, values (file value to code or catalog name) and note.',
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
      + 'A new card for the same file closes the pending one at once: it can no longer be approved, so do not warn the person about it. '
      + 'Approving the card records the mapping and imports nothing: no import runs from a mapping yet, in the chat or elsewhere. Say so, and do not offer to run it or point to another way of running it.',
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

    let summary: string;
    if (language === 'en') {
      switch (preview.status) {
        case 'pending': summary = `Map "${filename}" onto the ${list} import.`; break;
        case 'executed': summary = `Mapping of "${filename}" onto the ${list} import approved. ${importMappingNothingImportedText(language)}`; break;
        case 'rejected': summary = `Mapping of "${filename}" onto the ${list} import rejected.`; break;
        case 'expired': summary = `Mapping of "${filename}" onto the ${list} import expired before approval.`; break;
        case 'failed': summary = preview.error_message || `Mapping of "${filename}" onto the ${list} import failed.`; break;
        default: summary = `Preview ${preview.id} ${preview.status}.`;
      }
    } else {
      summary = previewSummaryText(language, preview.status, writeActionText.importMapping(language, filename, list), {
        executed: [importMappingNothingImportedText(language)],
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

  async executePreview(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
  ): Promise<void> {
    // The mapping is recorded by the approval itself. The file must still be the person's
    // spreadsheet of this conversation, as when the mapping was prepared.
    await this.mapping.assertTableAttachment(
      { ...context, conversationId: context.conversationId ?? preview.conversation_id ?? null },
      stringOf(preview.mutation_input?.attachment_id),
    );
  }
}
