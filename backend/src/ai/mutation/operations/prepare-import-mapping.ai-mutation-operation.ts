import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { writeAuditLog } from '../../../audit/audit.service';
import { IMPORT_EVENT_ACTION, IMPORT_EVENT_TABLE } from '../../../audit/security-events';
import { AiMutationPreview } from '../../ai-mutation-preview.entity';
import { AiExecutionContextWithManager, AiImportMappingPreviewDto } from '../../ai.types';
import {
  AiWriteLanguage,
  importCountsText,
  importRefusalText,
  personWriteLanguage,
  PREVIEW_IMPORT_CHECK_FAILED_MESSAGE,
  PREVIEW_IMPORT_NOTHING_MESSAGE,
  previewSummaryText,
  writeActionText,
} from '../../ai-write-texts';
import { AI_IMPORT_KEYS, AI_IMPORT_RESOURCES, aiImportAccess } from '../../import/ai-import-access';
import { AiImportMappingService, aiImportTarget, PrepareImportMappingInput } from '../../import/ai-import-mapping.service';
import { AI_IMPORT_TARGETS, parseImportChoices } from '../../import/ai-import-targets';
import { LOOKALIKE_CHOICE_WORDS_RULE } from '../../import/ai-import-runner.service';
import type { BudgetFileChoice } from '../../../spend/budget-file/types';
import { buildAiMutationAudit } from '../ai-mutation-audit.util';
import { AiMutationOperation, AiMutationPreviewPresentation, AiPreparedMutationPreview, AiPreviewExecutionRefusal } from '../ai-mutation-operation.types';

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
      + '({"Prod": "Production"}), a number ({"3 months": "3"}), a person\'s e-mail, a name as the workspace writes it; "" leaves the cell blank. '
      + 'For a budget file\'s supplier or dimension column: an existing value of the workspace only (a dimension\'s `values` in the template, '
      + 'a name of `matching.candidates`); the check refuses any other and the card shows each one.'),
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
    .describe('What the mapping supposes about the whole file, in the person\'s language (one row per server, the amounts are in euros). '
      + 'A row is named by its line of the file, as the summary numbers it (header counted). The card shows the rows and the values '
      + 'not read: do not describe them here.'),
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
  readonly description = 'Create a preview of how a spreadsheet the user attached maps onto the template of an import: '
    + 'one entry per template column, with the file column it reads (or one value for every row) and your confidence. '
    + 'Call describe_import_template first for the template\'s columns. The server reads the whole file, converts every row '
    + '(dates and times, numbers, yes/no, codes, catalog names and countries by name) and returns, per column, the values read and not read; '
    + 'the card shows the user the first rows and the values it could not read. To correct the mapping, call it again with the corrected mapping. '
    + 'The server also has the import check the file it builds (its dry run): the result gives the counts (rows to create, update, '
    + 'unchanged) and, per code and column, the number of errors and warnings with `file_lines`, the line of the file each one is on, '
    + 'as the card numbers it (header counted): name a line by that number. The card writes each message in the person\'s language. '
    + 'For a budget file, the check matches suppliers and dimension values to existing ones before creating any (accents, the four '
    + 'languages of the recommended dimensions, your `values`) and returns `matching`: the matches, your refused proposals, and the values '
    + 'nothing matched with their closest names. '
    + 'Requires explicit user approval. Approving runs the import with the user\'s rights; a card whose check found errors cannot be approved, '
    + 'nor a card with nothing to create or update (`nothing_to_import`).';
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
    prompt_hint: 'For a spreadsheet the user attached (an `<attached_table>` in their message) that they want imported, or that fits an import: '
      + 'call `describe_import_template` for the import it fits, then `prepare_import_mapping` with the attachment id and the mapping. '
      + 'Map a column only when its header or its first rows say what it holds; say what you supposed in `note` or `assumptions`, '
      + 'and name the file columns you leave out. When the card shows values not read, ask the user what they stand for and call again with `values`. '
      + 'References to other records (a company, a supplier, a server, a person) are copied as written: the import checks them when it runs. '
      + 'A budget file matches its suppliers and dimension values to the workspace\'s before it creates any: same name with other accents, '
      + 'or a value of a recommended dimension or of the sample data\'s business domain in another language (`matching.matches`, origin server). '
      + 'For a value the workspace names otherwise (a translation, a synonym, a spelling), map it in that column\'s `values` to an '
      + 'existing value from your first call: a dimension\'s `values` in the template or its `dimension_values` in `matching.candidates`; '
      + 'for a supplier, a name `matching.candidates` gives or a supplier you recognise as the same under another name '
      + '(AWS for Amazon Web Services), listed or not. The check accepts only an enabled value that exists and refuses the others '
      + '(`matching.refused_proposals`). '
      + 'Before you present the card, read each dimension value it creates (`matching.candidates` of outcome create) against its '
      + '`dimension_values`: when one is the same thing, call again with `values`. '
      + 'The card lists every match and the person may undo one. '
      + 'The card has a "Create missing suppliers" box, ticked unless the person unticked it, for a person who may create suppliers '
      + '(`matching.create_suppliers`): `new_suppliers` counts the suppliers the approval creates and the card lists them; '
      + '`new_dimension_values` counts the dimension values the approval creates, and the `matching.candidates` of outcome create name them '
      + '(one entry per value created; `matching.totals` gives the length of a list cut to its first entries). '
      + '`import_mapping.on_approval` says in one sentence what the approval creates and updates (for a budget file, by name, '
      + 'with what the check matched): announce exactly that, never a creation, an update or a record\'s name it does not carry '
      + '(none when it says 0), and call a matched value matched. Do not say the card will name records: it shows the counts of that sentence. '
      + 'When it says "Nothing to import", say so: the card cannot be approved (`validation.nothing_to_import`). '
      + 'Give no count of what the approval creates or updates (by nature included) other than the counts of that sentence, '
      + 'and never count the lines of the file yourself; lines in error, line numbers and amounts stay yours to cite. '
      + 'Name a value of a fixed list (a status, a priority) by its name in the template\'s `entries`, never by its code. '
      + 'Rows that look like a budget line the person reads (`similar_lines`) are left out unless the person chooses on the card '
      + 'to create them anyway or to update that line; the card holds those choices: never announce such a row as created. '
      + `${LOOKALIKE_CHOICE_WORDS_RULE} `
      + 'The person\'s choices on the card (`matching.choices`) are kept when you call again for the same file. '
      + 'A new card for the same file closes the pending one at once: it can no longer be approved, so do not warn the person about it. '
      + 'The card also shows the import\'s check of the file. When it finds errors, the card cannot be approved: say which columns and lines they are on, '
      + 'a column by its title and a row by its line of the file: the card writes each message in the person\'s language, so never write a code '
      + '(`BUDGET_FILE_...`, `CSV_...`), a template column key (`analytics:...`) or a cell. Help the user correct the mapping or the file, and call again. '
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

  /**
   * The card of a mapping. A card carries the person's choices (`choices`, set by the choice route: a
   * budget file's, or the matches undone of another import, lot I3 of 26.11.9): a new mapping of the
   * same file from the model keeps the choices of the file's last card; a budget file's check tells
   * the model which still apply.
   */
  async prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: PrepareImportMappingInput,
  ): Promise<AiPreparedMutationPreview> {
    const language = await personWriteLanguage(context.manager, context.tenantId, context.userId, context.screenLanguage);
    const budget = input.entity_type === 'budget_lines';
    const choices = input.choices ?? await this.lastChoices(context, input.attachment_id, input.entity_type);
    const { target, mapping } = await this.mapping.prepareMapping(context, { ...input, choices }, language);
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
        // The choices the check followed: an undone match the file no longer makes is dropped. A check
        // that refused the file before reading its rows followed none: the choices are kept as received.
        ...(budget ? { choices: mapping.validation?.matching ? mapping.validation.matching.choices : choices ?? [] } : {}),
        // Another import's matches undone, as received.
        ...(!budget && choices.length > 0 ? { choices } : {}),
      },
      currentValues: { import_mapping: mapping },
    };
  }

  /**
   * The choices of the person's last card of this file in the conversation, whatever its state (a
   * card replaced by a choice is expired, and the card that replaced it holds the choices): none once
   * that card was imported, or when it maps the file onto another import.
   */
  private async lastChoices(context: AiExecutionContextWithManager, attachmentId: string, key: string): Promise<BudgetFileChoice[]> {
    if (!context.conversationId) return [];
    const [last]: Array<{ status: string; choices: unknown; entity_type: string | null }> = await context.manager.query(
      `SELECT status, mutation_input->'choices' AS choices, mutation_input->>'entity_type' AS entity_type
         FROM ai_mutation_previews
        WHERE tenant_id = $1 AND conversation_id = $2 AND user_id = $3 AND tool_name = $4
          AND mutation_input->>'attachment_id' = $5
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [context.tenantId, context.conversationId, context.userId, this.toolName, attachmentId],
    );
    // A card of the file for another import: its choices are that import's.
    if (!last || last.status === 'executed' || last.entity_type !== key) return [];
    try {
      // The targets the last card left out by default are that card's: a new mapping looks again.
      return parseImportChoices(key, last.choices ?? []).filter((choice) => !(choice.kind === 'lookalikes' && choice.action === 'ignore'));
    } catch {
      return [];
    }
  }

  /** The cards that replace one another: those of one attached file. */
  replacementScope(input: Record<string, unknown>): string | null {
    return typeof input?.attachment_id === 'string' ? input.attachment_id : null;
  }

  /** A new mapping of the same file replaces the pending one: the person has one card to approve. */
  replacesPendingPreview(pending: AiMutationPreview, replacement: AiMutationPreview): boolean {
    return pending.mutation_input?.attachment_id === replacement.mutation_input?.attachment_id;
  }

  /**
   * A card whose check refused the file cannot be approved: the card shows its errors. Nor can a card
   * with nothing to import (P5 of 26.11.9). "Approve all" leaves both out.
   */
  isApprovable(preview: AiMutationPreview): boolean {
    const mapping = (preview.current_values?.import_mapping ?? null) as AiImportMappingPreviewDto | null;
    return mapping?.validation?.ok !== false && mapping?.validation?.nothing_to_import !== true;
  }

  /**
   * A card with nothing to import: its approval is refused before the import runs, and the card stays
   * pending (a budget file's choice, "Create anyway", can still give it something to import).
   */
  approvalRefusal(preview: AiMutationPreview): string | null {
    const mapping = (preview.current_values?.import_mapping ?? null) as AiImportMappingPreviewDto | null;
    return mapping?.validation?.ok === true && mapping.validation.nothing_to_import === true ? PREVIEW_IMPORT_NOTHING_MESSAGE : null;
  }

  presentPreview(preview: AiMutationPreview, language: AiWriteLanguage = 'en'): AiMutationPreviewPresentation {
    const mutation = preview.mutation_input ?? {};
    const key = stringOf(mutation.entity_type);
    const target = aiImportAccess(key) ? AI_IMPORT_TARGETS[key as keyof typeof AI_IMPORT_TARGETS] : null;
    const list = target?.names[language] ?? key;
    const filename = stringOf(mutation.filename);
    const mapping = (preview.current_values?.import_mapping ?? null) as AiImportMappingPreviewDto | null;
    const counts = mapping?.result ? importCountsText(language, mapping.result) : '';
    // A load refused at the approval: each row refused and its reason, which the model reads back.
    const refused = preview.status === 'failed' && mapping?.result && !mapping.result.ok
      ? importRefusalText(language, mapping.result, new Map(mapping.columns.map((column) => [column.column, column.title])))
      : '';

    let summary: string;
    if (language === 'en') {
      switch (preview.status) {
        case 'pending': summary = `Import "${filename}" into the ${list} list.`; break;
        case 'executed': summary = `"${filename}" imported into the ${list} list.${counts ? ` ${counts}` : ''}`; break;
        case 'rejected': summary = `Import of "${filename}" into the ${list} list rejected.`; break;
        case 'expired': summary = `Import of "${filename}" into the ${list} list expired before approval.`; break;
        case 'failed': summary = refused
          ? `Import of "${filename}" into the ${list} list failed. ${refused}`
          : preview.error_message || `Import of "${filename}" into the ${list} list failed.`; break;
        default: summary = `Preview ${preview.id} ${preview.status}.`;
      }
    } else {
      summary = previewSummaryText(language, preview.status, writeActionText.importFile(language, filename, list), {
        executed: counts ? [counts] : [],
        errorMessage: refused ? null : preview.error_message,
      });
      if (refused) summary = `${summary} ${refused}`;
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
    if (!mapping?.validation?.ok) throw new Error(PREVIEW_IMPORT_CHECK_FAILED_MESSAGE);
    const input = preview.mutation_input as unknown as PrepareImportMappingInput;
    const language = await personWriteLanguage(context.manager, context.tenantId, context.userId, context.screenLanguage);
    const result = await this.mapping.runImport(
      { ...context, conversationId: context.conversationId ?? preview.conversation_id ?? null },
      input,
      language,
    );
    // Refused by the load: the card keeps its check, which gives the reason of each row refused.
    if (!result.ok) throw new AiPreviewExecutionRefusal(PREVIEW_IMPORT_CHECK_FAILED_MESSAGE, { import_mapping: { ...mapping, result } });

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
