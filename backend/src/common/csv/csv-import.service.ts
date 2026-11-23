import { Injectable, BadRequestException } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { parseString } from '@fast-csv/parse';
import type { CsvLanguage } from '../csv-sheet/types';
import { parseCsvBoolean } from '../csv-sheet/boolean';
import { knownTimeZone, readTimeZoneHeader } from '../csv-sheet/date';
import { CsvDecodeError } from '../csv-sheet/decode';
import { csvSeparatorOf, readImportText } from '../csv-sheet/read';
import { looseKey } from '../csv-sheet/text';
import { labelsForEnum } from '../../ai/import/ai-import-code-labels';
import { sameStoredValue, sameStoredValues } from '../csv-sheet/unchanged';
import { GUARDED_DASH } from '../csv-sheet/clear';
import { importCell, markGuardedDash, noteCleared, refuseClear, removedEntries } from './csv-import-cells';
import { isNumberedColumn, numberedColumns, numberedListColumnOf } from './csv-numbered-lists';
import { writeAuditLogs, type AuditSourceOptions } from '../../audit/audit.service';
import {
  ArrayStrategy,
  CsvCallerAccess,
  CsvEntityConfig,
  CsvFieldDefinition,
  CsvFieldType,
  CsvImportContext,
  CsvCellError,
  CsvImportError,
  CsvImportParams,
  CsvImportResult,
  CsvImportRow,
  CsvImportWarning,
} from './csv-field.types';
import { CsvResolverService } from './csv-resolver.service';
import { listedMatches, listedRefusedProposals, noteNameMatch, noteRefusedProposal, proposalFor, undoneMatch } from '../name-matching';
import { denormalizeCsvFormulaValue } from './csv-export.service';
import { CsvJsonValidators } from './csv-json-validators';
import { isRichTextContentRefusal } from '../markdown-limits';
import { markdownWorkBudget } from '../markdown-worker';
import { uploadedBytes } from '../upload';
import { listedUpdates, type ImportUpdate } from '../csv-sheet/master-data';

/** A stored record as the result names it (`CsvEntityConfig.recordLabel`): by default its name or title, no reference. */
function recordLabelOf(config: CsvEntityConfig, entity: any): { ref: string | null; name: string } {
  if (config.recordLabel) return config.recordLabel(entity ?? {});
  return { ref: null, name: String(entity?.name ?? entity?.title ?? '') };
}

/**
 * Import options
 */
/**
 * The column a header names: a field's technical name or its title in any language (`headerLabels`),
 * whatever the case, the spaces and the underscores; any other header as it came. For code that
 * reads a file's rows again after the import (`importable` aside, as the import reads them).
 */
export function csvColumnOfHeader(config: CsvEntityConfig, header: string): string {
  const key = looseKey(header).normalize('NFC');
  for (const field of config.fields) {
    const names = [field.csvColumn, ...Object.values(config.headerLabels?.[field.csvColumn] ?? {})];
    if (names.some((name) => name && looseKey(name).normalize('NFC') === key)) return field.csvColumn;
  }
  return header;
}

export interface CsvImportOptions {
  /** TypeORM EntityManager */
  manager: EntityManager;
  /** Tenant ID */
  tenantId: string;
  /** User ID performing the import */
  userId?: string | null;
  /** True when the importer may lift a confidential flag. */
  isAdmin?: boolean;
  /** Register viewer (userId + incidents:admin). */
  viewer?: { userId: string | null; isAdmin: boolean };
  /** Effective IT Ops catalogs for code/label resolution (see CsvImportContext). */
  itOpsSettings?: import('../../it-ops-settings/it-ops-settings.service').ItOpsSettings;
  /** The file's language (the screen's, else the user's). See CsvImportContext. */
  language?: CsvLanguage;
  /** The person's rights: names found beyond case in the families they read. See CsvImportContext. */
  access?: CsvCallerAccess;
  /** The source of each record's history row (Kad's card); without it, the person's. See CsvImportContext. */
  audit?: AuditSourceOptions;
}

/** A reference cell nothing finds, or that may name several records: what parseFk and the lists do with it. */
type ReferenceLookup = { id: string } | { many: string[] } | null;

/** What the import needs to know of a stored column to clear it. */
interface StoredColumn {
  nullable: boolean;
  /** A number column: `-` on it, NOT NULL, says to write 0. */
  numeric: boolean;
  /** The empty value of a NOT NULL list or object column (`[]`, `{}`); undefined for any other. */
  empty?: () => unknown[] | Record<string, never>;
}

/** A property `-` cleared: the column of the cell, the empty value it was given, and whether it counts as one stored value. */
interface ClearedProperty {
  csvColumn: string;
  value: unknown;
  /** False for a nested list left empty by its sub-columns, which count themselves. */
  counted: boolean;
}

/**
 * The clearing rule (`csv-import-cells.ts`): the columns of the table, read when the file holds a
 * `-`, and, per row, the properties `-` cleared (checked once the entity hooks ran) and the nested
 * sub-values it cleared.
 */
interface ClearRules {
  columns: Map<string, StoredColumn>;
  cleared: WeakMap<CsvImportRow, Map<string, ClearedProperty>>;
  nestedCleared: WeakMap<CsvImportRow, number>;
}

const NUMERIC_TYPES = new Set(['smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision']);

/**
 * Service for importing entities from CSV format.
 *
 * Features:
 * - Two-phase import: validate all rows, then commit
 * - Identity resolution (id column or natural key)
 * - FK resolution with preloading
 * - One clearing rule (`csv-import-cells.ts`): a blank cell keeps, `-` clears
 * - insert_only, update_only, upsert operations
 * - Duplicate detection within same file
 */
@Injectable()
export class CsvImportService {
  /** Default max items for array fields */
  private readonly DEFAULT_MAX_ITEMS = 4;
  private readonly AUDITED_IMPORT_TABLES = new Set<string>([
    'tasks',
    'incidents',
    'applications',
    'portfolio_requests',
    'portfolio_projects',
    'assets',
  ]);

  constructor(
    private readonly resolver: CsvResolverService,
    private readonly jsonValidators: CsvJsonValidators,
  ) {}

  /**
   * Import entities from CSV file.
   *
   * @param config - Entity CSV configuration
   * @param file - Uploaded file
   * @param params - Import parameters (dryRun, operation)
   * @param opts - Import options
   * @returns Import result with counts and errors
   */
  async import(
    config: CsvEntityConfig,
    file: Express.Multer.File,
    params: CsvImportParams,
    opts: CsvImportOptions,
  ): Promise<CsvImportResult> {
    // Decode and parse CSV
    const { rows, headerErrors, headerWarnings, timeZones, firstSheetOnly } = await this.parseCsv(config, file, opts.language);
    // A workbook of several sheets: the report says which one was read, on every outcome.
    if (firstSheetOnly !== undefined) {
      headerWarnings.push({
        row: 0,
        message: `Only the first sheet, ${firstSheetOnly}, was read.`,
        code: 'XLSX_FIRST_SHEET_ONLY',
        params: { name: firstSheetOnly },
      });
    }

    // Early return if header errors
    if (headerErrors.length > 0) {
      return {
        ok: false,
        dryRun: params.dryRun,
        total: 0,
        inserted: 0,
        updated: 0,
        skipped: 0,
        unchanged: 0,
        cleared: 0,
        errors: headerErrors,
        warnings: headerWarnings,
      };
    }

    // Get importable fields
    const importFields = config.fields.filter((f) => f.importable !== false);

    // Preload FK resolvers
    const resolverCache = await this.resolver.preloadResolvers(
      opts.tenantId,
      importFields,
      opts.manager,
    );

    // Create import context
    const context: CsvImportContext = {
      tenantId: opts.tenantId,
      manager: opts.manager,
      params,
      resolverCache,
      userId: opts.userId,
      isAdmin: opts.isAdmin,
      viewer: opts.viewer ?? { userId: opts.userId ?? null, isAdmin: opts.isAdmin === true },
      itOpsSettings: opts.itOpsSettings,
      markdownBudget: markdownWorkBudget(),
      timeZones,
      language: opts.language,
      access: opts.access,
      audit: opts.audit,
      nameMatches: new Map(),
      refusedProposals: new Map(),
    };

    // `-` clears a value by the stored column's rules, read once when the file holds a `-`.
    const rules = rows.some((raw) => Object.keys(raw).some((column) => importCell(raw, column).kind === 'clear'))
      ? await this.loadClearRules(config, opts.manager)
      : null;

    // Phase 1: Validate and parse all rows
    const parsedRows = await this.validateAndParseRows(config, rows, importFields, context, rules);

    // Duplicate upsert keys within the file, as the file gives them: the rows the config left out
    // count too, and a config's hooks may not change a row's key after (the applications' "Update
    // APP-n" keeps the stored name).
    const duplicateErrors = this.checkDuplicateKeys(config, parsedRows);

    // The rows the config left out (`settleRows`) are neither read nor written.
    const readRows = parsedRows.filter((row) => !row.leftOut);
    if (config.afterValidate) await config.afterValidate(readRows, context);
    if (rules) this.checkClearedColumns(readRows, rules, params.operation);
    this.clearKeptReferencesOfChangedOwners(readRows, importFields);

    // Collect all errors
    const allErrors: CsvImportError[] = [];
    const allWarnings: CsvImportWarning[] = [...headerWarnings];

    for (const row of parsedRows) {
      allErrors.push(...row.errors);
      allWarnings.push(...row.warnings);
    }
    allErrors.push(...duplicateErrors);

    // Matched rows identical to what is stored: counted, never written.
    if (params.operation !== 'insert_only') {
      const matched = readRows.filter((row) => row.errors.length === 0 && !row.isInsert);
      const same = config.sameAsStored
        ? await config.sameAsStored(matched, context)
        : matched.map((row) => sameStoredValues(row.existingEntity, row.parsed));
      // A row whose hooks declared cleared values (`noteCleared`) writes them.
      matched.forEach((row, i) => { row.unchanged = same[i] === true && !(row.clearedByConfig ?? 0); });
    }

    // Count operations
    let insertCount = 0;
    let updateCount = 0;
    let skipCount = 0;
    let unchangedCount = 0;
    let clearedCount = 0;
    // The rows that update a stored record, named by its reference and name (Q1 of 26.11.9).
    const updates: ImportUpdate[] = [];

    for (const row of parsedRows) {
      if (row.errors.length > 0 || row.leftOut) {
        skipCount++;
        continue;
      }
      if (!row.isInsert && params.operation !== 'insert_only' && !row.unchanged) {
        clearedCount += this.clearedValues(row, importFields, rules);
      }

      if (row.isInsert) {
        if (params.operation === 'update_only') {
          skipCount++;
        } else {
          insertCount++;
        }
      } else {
        if (params.operation === 'insert_only') {
          skipCount++;
        } else if (row.unchanged) {
          unchangedCount++;
        } else {
          updateCount++;
          updates.push({ row: row.rowNumber, ...recordLabelOf(config, row.existingEntity) });
        }
      }
    }

    // If there are errors or it's a dry run, return without committing
    if (allErrors.length > 0 || params.dryRun) {
      return {
        ok: allErrors.length === 0,
        dryRun: params.dryRun,
        total: rows.length,
        inserted: insertCount,
        updated: updateCount,
        skipped: skipCount,
        unchanged: unchangedCount,
        cleared: clearedCount,
        errors: allErrors,
        warnings: allWarnings,
        ...this.matchesOf(context),
        ...listedUpdates(updates),
      };
    }

    // Phase 2: Commit changes
    try {
      await this.commitChanges(config, parsedRows, context);
    } catch (error: any) {
      return {
        ok: false,
        dryRun: false,
        total: rows.length,
        inserted: 0,
        updated: 0,
        skipped: rows.length,
        unchanged: 0,
        cleared: 0,
        errors: [{
          row: 0,
          message: `Import failed: ${error.message}`,
          code: 'CSV_IMPORT_FAILED',
          params: { reason: error.message },
        }],
        warnings: allWarnings,
      };
    }

    return {
      ok: true,
      dryRun: false,
      total: rows.length,
      inserted: insertCount,
      updated: updateCount,
      skipped: skipCount,
      unchanged: unchangedCount,
      cleared: clearedCount,
      errors: [],
      warnings: allWarnings,
      ...this.matchesOf(context),
      ...listedUpdates(updates),
    };
  }

  /**
   * The names the import found beyond case and Kad's proposals it refused, for the result: the first
   * ones and their totals; nothing when none.
   */
  private matchesOf(context: CsvImportContext): Pick<CsvImportResult, 'matches' | 'matchesTotal' | 'refusedProposals' | 'refusedProposalsTotal'> {
    return { ...listedMatches(context.nameMatches), ...listedRefusedProposals(context.refusedProposals) };
  }

  /**
   * Parse the file and validate headers: a CSV file, or the first sheet of an .xlsx workbook turned
   * into the same CSV text (`readImportText`), so both are read by the same parser and rules.
   */
  private async parseCsv(
    config: CsvEntityConfig,
    file: Express.Multer.File,
    language?: CsvLanguage,
  ): Promise<{
    rows: Record<string, string>[];
    headerErrors: CsvImportError[];
    headerWarnings: CsvImportWarning[];
    timeZones: Record<string, string>;
    /** A workbook of several sheets: the name of the one read, the first. */
    firstSheetOnly?: string;
  }> {
    const buf = uploadedBytes(file);

    let content: string;
    let firstSheetOnly: string | undefined;
    try {
      const read = await readImportText(buf, { keepsGuardedDash: true });
      content = read.text;
      if (read.format === 'xlsx' && (read.sheetCount ?? 1) > 1) firstSheetOnly = read.sheetName;
    } catch (err) {
      if (err instanceof CsvDecodeError) {
        throw new BadRequestException({ message: err.message, code: err.code });
      }
      throw err;
    }

    const rows: Record<string, string>[] = [];
    const headerErrors: CsvImportError[] = [];
    const headerWarnings: CsvImportWarning[] = [];

    // Get expected headers for importable fields
    const expectedHeaders = this.getExpectedHeaders(config);
    // A report names a column by its title in the screen language, as the example file does.
    // A column with no title in that language keeps its technical key.
    const columnTitle = (column: string): string =>
      (language ? config.headerLabels?.[column]?.[language] : undefined) ?? column;

    // A date-time column may name the zone of its cells after its name (`detected_at
    // (Europe/Paris)`, as the export writes it): the row is read by the plain name, and the
    // transform reads the cells in that zone. Without a zone, the cells are UTC, and the report
    // says which columns were read that way.
    const zonedColumns = new Set(
      config.fields.filter((f) => f.zonedDateTime && f.importable !== false).map((f) => f.csvColumn),
    );
    const timeZones: Record<string, string> = {};
    const zoneless: string[] = [];

    // A header names its column in the file's language when the config translates it
    // (`headerLabels`): the export writes that text, and the import reads it back as the column.
    // The technical `csvColumn` stays accepted, so an older or hand-made file still reads.
    const headerKey = (value: string) => looseKey(value).normalize('NFC');
    const headerAliases = new Map<string, string>();
    for (const field of config.fields) {
      if (field.importable === false) continue;
      headerAliases.set(headerKey(field.csvColumn), field.csvColumn);
      for (const label of Object.values(config.headerLabels?.[field.csvColumn] ?? {})) {
        if (label) headerAliases.set(headerKey(label), field.csvColumn);
      }
    }

    const readHeader = (header: string | null | undefined) => {
      if (header == null) return header;
      // A whole title is read first: a translated one may end in parentheses ("Progression (%)").
      const titled = headerAliases.get(headerKey(header));
      if (titled) {
        if (zonedColumns.has(titled)) zoneless.push(titled);
        return titled;
      }
      const named = readTimeZoneHeader(header);
      const column = headerAliases.get(headerKey(named ? named.column : header));
      if (!column) {
        // A numbered column beyond the declared ones (`business_owner_email_5`), by its name or a title.
        const listed = named ? undefined : numberedListColumnOf(config, header);
        if (listed) return listed;
        // Not a column of this config: keep it as it came, so the ignored-column warning names it.
        if (zonedColumns.has(header)) zoneless.push(header);
        return header;
      }
      if (!zonedColumns.has(column)) {
        // A zone on a column that has none is not ours to read: keep the cell as it came.
        return named ? header : column;
      }
      if (!named) {
        zoneless.push(column);
        return column;
      }
      const zone = knownTimeZone(named.zone);
      if (zone) {
        timeZones[column] = zone;
      } else {
        const namedColumn = columnTitle(column);
        headerErrors.push({
          row: 0,
          column: namedColumn,
          message: `Unknown time zone in the ${namedColumn} column: "${named.zone}". Use a zone such as Europe/Paris or UTC.`,
          code: 'CSV_HEADER_UNKNOWN_TIME_ZONE',
          params: { column: namedColumn, zone: named.zone },
        });
      }
      return column;
    };

    await new Promise<void>((resolve, reject) => {
      parseString(content, {
        headers: (headers) => headers.map(readHeader),
        // Read from the header, as the shared layer does: an English export uses commas, the
        // other languages and every older file semicolons.
        delimiter: csvSeparatorOf(content) ?? ';',
        ignoreEmpty: true,
        trim: true,
      })
        .on('headers', (headers: string[]) => {
          // Validate headers. The file is matched on the technical key; the report names the title.
          // Only the columns that find the record are required, and none when the file holds the
          // identity column: a column left out is not touched.
          const missing = expectedHeaders.identity && headers.includes(expectedHeaders.identity)
            ? []
            : expectedHeaders.required.filter((header) => !headers.includes(header)).map(columnTitle);
          const extra = headers.filter(
            (h) => !expectedHeaders.all.has(h) && !h.startsWith('_') && !numberedListColumnOf(config, h),
          );

          if (missing.length > 0) {
            headerErrors.push({
              row: 0,
              message: `Missing required columns: ${missing.join(', ')}`,
              code: 'CSV_HEADER_MISSING_COLUMNS',
              params: { missing: missing.join(', ') },
            });
          }

          if (zoneless.length > 0) {
            const columns = zoneless.map(columnTitle);
            headerWarnings.push({
              row: 0,
              message: `Times without a time zone, read as UTC: ${columns.join(', ')}`,
              code: 'CSV_HEADER_ZONELESS_DATE_TIMES',
              params: { columns: columns.join(', '), example: columns[0] },
            });
          }

          // The rows are read by column name: an unknown column is left out of the import.
          if (extra.length > 0) {
            headerWarnings.push({
              row: 0,
              message: `Unknown columns (will be ignored): ${extra.join(', ')}`,
              code: 'CSV_HEADER_IGNORED_COLUMNS',
              params: { extra: extra.join(', ') },
            });
          }
        })
        .on('error', (err) => reject(err))
        .on('data', (row: Record<string, string>) => {
          // Strip the protective apostrophe our export prepends to
          // formula-like values, so export -> import round-trips cleanly. `'-` is the text "-": the
          // row holds "-" and the cell is noted, for `importCell` to tell it from a `-` that clears.
          for (const key of Object.keys(row)) {
            if (String(row[key] ?? '').trim() === GUARDED_DASH) {
              row[key] = '-';
              markGuardedDash(row, key);
            } else {
              row[key] = denormalizeCsvFormulaValue(row[key]);
            }
          }
          rows.push(row);
        })
        .on('end', () => resolve());
    });

    return { rows, headerErrors, headerWarnings, timeZones, firstSheetOnly };
  }

  /**
   * The columns of the config, and those a file must hold to find its records (T-I6i of 26.11.9):
   * the required columns of the matching key, unless the file holds the identity column. Any other
   * required value is checked on the rows that create a record.
   */
  private getExpectedHeaders(config: CsvEntityConfig): {
    required: string[];
    all: Set<string>;
    identity?: string;
  } {
    const importFields = config.fields.filter((f) => f.importable !== false);
    const required: string[] = [];
    const all = new Set<string>();

    const processedArrays = new Set<string>();

    for (const field of importFields) {
      // Handle numbered column arrays
      if (
        field.type === CsvFieldType.ARRAY &&
        field.arrayStrategy === ArrayStrategy.NUMBERED_COLUMNS
      ) {
        const baseName = field.csvColumn.replace(/_\d+$/, '');
        if (processedArrays.has(baseName)) {
          continue;
        }
        processedArrays.add(baseName);

        const maxItems = field.maxItems ?? this.DEFAULT_MAX_ITEMS;
        for (let i = 1; i <= maxItems; i++) {
          const colName = `${baseName}_${i}`;
          all.add(colName);
        }
      } else if (!field.arrayIndex) {
        all.add(field.csvColumn);
        if (field.required && config.upsertKey.includes(field.entityProperty)) {
          required.push(field.csvColumn);
        }
      }
    }

    return { required, all, identity: config.fields.find((f) => f.isIdentityColumn)?.csvColumn };
  }

  /**
   * Validate and parse all rows.
   */
  private async validateAndParseRows(
    config: CsvEntityConfig,
    rows: Record<string, string>[],
    importFields: CsvFieldDefinition[],
    context: CsvImportContext,
    rules: ClearRules | null,
  ): Promise<CsvImportRow[]> {
    const parsedRows: CsvImportRow[] = [];

    const preliminaryRows: CsvImportRow[] = rows.map((raw, i) => ({
      rowNumber: i + 2,
      raw,
      parsed: {},
      isInsert: true,
      errors: [],
      warnings: [],
    }));
    if (config.beforeValidate) {
      await config.beforeValidate(preliminaryRows, context);
    }

    // Load existing entities for identity resolution
    const { entities: existingEntities, deleted } = await this.loadExistingEntities(config, rows, context);
    // The record each row updates, by its id or key, before any cell is read; then as the config
    // settles it (another record, or the row left out: lot I3 of 26.11.9).
    const found = rows.map((raw) => this.resolveIdentity(config, raw, existingEntities));
    const settled = config.settleRows
      ? await config.settleRows(rows.map((raw, i) => ({ raw, rowNumber: i + 2, found: found[i] })), context)
      : null;

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      const rowNumber = i + 2; // 1-based, accounting for header
      const settle = settled?.[i];
      if (settle?.leaveOut) {
        // Only its key is read, for the file's duplicates.
        const keyed: CsvImportRow = { rowNumber, raw, parsed: {}, isInsert: true, errors: [], warnings: [] };
        for (const field of importFields) if (config.upsertKey.includes(field.entityProperty)) await this.parseField(config, field, raw, keyed, context, rules);
        parsedRows.push({ rowNumber, raw, parsed: keyed.parsed, isInsert: true, leftOut: true, errors: [], warnings: settle.warnings ?? [] });
        continue;
      }

      const parsedRow: CsvImportRow = {
        rowNumber,
        raw,
        parsed: {},
        isInsert: true,
        errors: [...(preliminaryRows[i]?.errors ?? [])],
        warnings: [...(preliminaryRows[i]?.warnings ?? [])],
      };

      if (settle) {
        parsedRow.errors.push(...(settle.errors ?? []));
        parsedRow.warnings.push(...(settle.warnings ?? []));
      }
      if (found[i] && deleted.has(String(found[i].id))) {
        parsedRow.errors.push({ row: rowNumber, code: 'CSV_RECORD_DELETED', message: 'This record was deleted during the import.' });
      }

      // The record the row updates, known before its cells are read: `-` and a blank required cell
      // read differently on a new record.
      const existingEntity = settle ? settle.entity : found[i];
      if (existingEntity) {
        parsedRow.existingEntity = existingEntity;
        parsedRow.isInsert = false;
      }

      // Parse and validate each field
      for (const field of importFields) {
        await this.parseField(config, field, raw, parsedRow, context, rules);
      }

      if (existingEntity) this.keepStoredRichText(importFields, raw, parsedRow, existingEntity);

      // NESTED fields (`ip_1_type`, ...), applied onto the stored list.
      this.applyNestedFields(importFields, raw, parsedRow, rules);

      if (existingEntity) {
        // A blank cell keeps the stored value (also a column the file leaves out, as hooks read the
        // whole record from `parsed`). Lists and nested fields keep theirs above.
        for (const field of importFields) {
          if (field.type === CsvFieldType.NESTED || this.isNumbered(field)) continue;
          if (importCell(raw, field.csvColumn).kind === 'blank' && field.entityProperty in existingEntity) {
            parsedRow.parsed[field.entityProperty] = existingEntity[field.entityProperty];
          }
        }

        // A name nothing finds keeps the stored reference of the record it updates.
        this.keepStoredReferences(importFields, parsedRow, existingEntity);
      }

      // Run async JSON validators
      await this.runJsonValidators(parsedRow, importFields, context);

      parsedRows.push(parsedRow);
    }

    return parsedRows;
  }

  /**
   * On a row that updates a record (lot I3 of 26.11.9): a reference cell whose name nothing finds
   * keeps the stored value instead of emptying it, and a numbered list with such a cell keeps the
   * stored list whole. Each such cell is said (`CSV_REFERENCE_NOT_FOUND_KEPT`). A new record is not
   * concerned.
   */
  private keepStoredReferences(fields: CsvFieldDefinition[], row: CsvImportRow, existingEntity: any): void {
    for (const field of fields) {
      if (!field.fkEntity || !(field.entityProperty in existingEntity)) continue;
      const numbered = field.type === CsvFieldType.ARRAY && field.arrayStrategy === ArrayStrategy.NUMBERED_COLUMNS;
      const baseName = field.csvColumn.replace(/_\d+$/, '');
      const inField = (column: string) => (numbered ? isNumberedColumn(column, baseName) : column === field.csvColumn);
      const code = numbered ? 'CSV_REFERENCE_NOT_FOUND_SKIPPED' : 'CSV_REFERENCE_NOT_FOUND_CLEARED';
      const missing = row.warnings.filter((warning) => warning.code === code && warning.column !== undefined && inField(warning.column));
      if (missing.length === 0) continue;
      row.parsed[field.entityProperty] = existingEntity[field.entityProperty];
      for (const warning of missing) {
        warning.code = 'CSV_REFERENCE_NOT_FOUND_KEPT';
        warning.message = `${field.fkEntity} not found: "${warning.params?.value ?? ''}" (kept)`;
      }
    }
  }

  /**
   * Once the hooks ran: a stored reference kept for a name nothing finds (`keepStoredReferences`)
   * must still hold for the record as the row leaves it. A reference that belongs to other
   * properties of the record (`keptWith`) is not kept when the row changes one of them: it is
   * cleared, and said (`CSV_REFERENCE_NOT_FOUND_CLEARED`). A stored value it clears counts in
   * `cleared` (`noteCleared`): this runs at the check as at the load.
   */
  private clearKeptReferencesOfChangedOwners(rows: CsvImportRow[], fields: CsvFieldDefinition[]): void {
    const dependent = fields.filter((field) => field.fkEntity && field.keptWith?.length);
    if (dependent.length === 0) return;
    const same = (left: unknown, right: unknown) => String(left ?? '').trim().toLowerCase() === String(right ?? '').trim().toLowerCase();
    for (const row of rows) {
      const stored = row.existingEntity;
      if (!stored) continue;
      for (const field of dependent) {
        const changed = field.keptWith!.some((property) => Object.prototype.hasOwnProperty.call(row.parsed, property) && !same(row.parsed[property], stored[property]));
        if (!changed) continue;
        const kept = row.warnings.filter((warning) => warning.column === field.csvColumn && warning.code === 'CSV_REFERENCE_NOT_FOUND_KEPT');
        if (kept.length === 0) continue;
        row.parsed[field.entityProperty] = null;
        // A stored value cleared, counted at the check as at the load (this runs before both).
        if (stored[field.entityProperty] != null) noteCleared(row, 1);
        for (const warning of kept) {
          warning.code = 'CSV_REFERENCE_NOT_FOUND_CLEARED';
          warning.message = `${field.fkEntity} not found: "${warning.params?.value ?? ''}" (set to null)`;
        }
      }
    }
  }

  /**
   * A rich-text cell refused for an HTML tag or for the address of a link, that repeats the
   * stored text of its column, is no error: a text saved before that rule stays as it is, and its row stays importable.
   */
  private keepStoredRichText(
    fields: CsvFieldDefinition[],
    raw: Record<string, string>,
    row: CsvImportRow,
    existingEntity: any,
  ): void {
    row.errors = row.errors.filter((error) => {
      if (!isRichTextContentRefusal(error.code)) return true;
      const field = fields.find((candidate) => candidate.csvColumn === error.column);
      const stored = field ? existingEntity[field.entityProperty] : undefined;
      if (!field || typeof stored !== 'string' || stored.trim() !== this.getRawValue(field, raw)) return true;
      row.parsed[field.entityProperty] = stored;
      return false;
    });
  }

  /**
   * Parse a single field from the raw row, by the clearing rule (`importCell`): a blank cell keeps
   * (a required one refuses only a new record), `-` clears (refused on the key and on a required
   * value; a blank cell on a new record), anything else is read by the field's type.
   */
  private async parseField(
    config: CsvEntityConfig,
    field: CsvFieldDefinition,
    raw: Record<string, string>,
    row: CsvImportRow,
    context: CsvImportContext,
    rules: ClearRules | null,
  ): Promise<void> {
    // Handle numbered column arrays
    if (this.isNumbered(field)) {
      this.parseNumberedArrayField(field, raw, row, context, rules);
      return;
    }

    // Skip array index fields (handled by parseNumberedArrayField)
    if (field.arrayIndex) {
      return;
    }

    // Skip NESTED fields (handled by applyNestedFields)
    if (field.type === CsvFieldType.NESTED) {
      return;
    }

    // A column the file leaves out reads as a blank cell: never touched, required on a new record.
    const cell = importCell(raw, field.csvColumn);

    if (cell.kind === 'clear') {
      if (field.required || field.isIdentityColumn || config.upsertKey.includes(field.entityProperty)) {
        refuseClear(row, field.csvColumn);
      } else if (!row.isInsert && rules) {
        this.clearField(field.entityProperty, field.csvColumn, row, rules);
      }
      return;
    }

    if (cell.kind === 'blank') {
      if (field.required && row.isInsert) {
        row.errors.push({
          row: row.rowNumber,
          column: field.csvColumn,
          message: `${field.csvColumn} is required`,
          code: 'CSV_VALUE_REQUIRED',
        });
      }
      return;
    }

    // Parse based on type
    try {
      // A transform may be asynchronous (rich text processed in the Markdown workers).
      const parsedValue = await this.parseValue(field, cell.text, row, context);
      if (parsedValue !== undefined) {
        row.parsed[field.entityProperty] = parsedValue;
      }
    } catch (error: any) {
      const code = error instanceof CsvCellError ? error.code : error?.getResponse?.()?.code;
      const params = error instanceof CsvCellError ? error.params : undefined;
      row.errors.push({
        row: row.rowNumber,
        column: field.csvColumn,
        message: error.message,
        ...(typeof code === 'string' ? { code } : {}),
        ...(params ? { params } : {}),
      });
    }
  }

  /** A list written in numbered columns (`owner_email_1` to `_4`). */
  private isNumbered(field: CsvFieldDefinition): boolean {
    return field.type === CsvFieldType.ARRAY && field.arrayStrategy === ArrayStrategy.NUMBERED_COLUMNS;
  }

  /**
   * NESTED fields (`ip_1_type`, `ip_1_address`, ...), applied onto the stored list of the record
   * (none for a new one), for the sub-columns the file holds: a blank one keeps its value, `-` clears
   * its sub-value (one cleared value), any other value sets it; an entry left with no value is taken
   * out, and a list left empty is cleared. Entries beyond the file's columns are kept.
   */
  private applyNestedFields(
    fields: CsvFieldDefinition[],
    raw: Record<string, string>,
    row: CsvImportRow,
    rules: ClearRules | null,
  ): void {
    const byProperty = new Map<string, CsvFieldDefinition[]>();
    for (const field of fields) {
      if (field.type !== CsvFieldType.NESTED || !field.nestedPath) continue;
      byProperty.set(field.entityProperty, [...(byProperty.get(field.entityProperty) ?? []), field]);
    }
    const hasValue = (value: unknown) => value != null && value !== '';
    for (const [property, propFields] of byProperty) {
      const held = propFields.filter((field) => this.hasColumn(raw, field.csvColumn));
      const stored = row.isInsert ? undefined : row.existingEntity?.[property];
      const entries: Array<Record<string, unknown>> = Array.isArray(stored)
        ? stored.map((entry) => (entry && typeof entry === 'object' ? { ...entry } : {}))
        : [];
      let changed = false;
      let clearedValues = 0;
      for (const field of held) {
        const path = field.nestedPath!.match(/^\[(\d+)\]\.(.+)$/);
        if (!path) continue;
        const cell = importCell(raw, field.csvColumn);
        if (cell.kind === 'blank' || (cell.kind === 'clear' && row.isInsert)) continue;
        const index = Number(path[1]);
        while (entries.length <= index) entries.push({});
        if (cell.kind === 'clear') {
          if (hasValue(entries[index][path[2]])) clearedValues += 1;
          delete entries[index][path[2]];
        } else {
          entries[index][path[2]] = cell.text;
        }
        changed = true;
      }
      if (!changed) {
        // Nothing said: the stored list is kept as it is.
        if (Array.isArray(stored)) row.parsed[property] = stored;
        continue;
      }
      if (clearedValues > 0 && rules) rules.nestedCleared.set(row, (rules.nestedCleared.get(row) ?? 0) + clearedValues);
      const kept = entries.filter((entry) => Object.values(entry).some(hasValue));
      if (kept.length > 0) row.parsed[property] = kept;
      else if (!row.isInsert && rules) this.clearField(property, held[0].csvColumn, row, rules, false);
    }
  }

  /**
   * Parse a numbered array field (e.g., owner_email_1..4, and every further `owner_email_<n>` the file
   * holds): the cells that hold values are the whole list. Every cell blank keeps the stored list; `-`
   * with no value clears it (a `-` among values adds nothing to them). A required list refuses only a
   * new record without a value.
   */
  private parseNumberedArrayField(
    field: CsvFieldDefinition,
    raw: Record<string, string>,
    row: CsvImportRow,
    context: CsvImportContext,
    rules: ClearRules | null,
  ): void {
    const baseName = field.csvColumn.replace(/_\d+$/, '');
    const values: any[] = [];

    // A list the file leaves out (none of its numbered columns) is never touched.
    const columns = numberedColumns(raw, baseName);
    if (columns.length === 0) {
      return;
    }
    const cells = columns.map((colName) => importCell(raw, colName));

    if (!cells.some((cell) => cell.kind === 'value')) {
      if (cells.some((cell) => cell.kind === 'clear') && !row.isInsert) {
        if (field.required) refuseClear(row, `${baseName}_1`);
        else if (rules) this.clearField(field.entityProperty, `${baseName}_1`, row, rules);
        return;
      }
      if (field.required && row.isInsert) {
        row.errors.push({
          row: row.rowNumber,
          column: `${baseName}_1`,
          message: `At least one ${baseName} is required`,
          code: 'CSV_VALUE_ONE_REQUIRED',
          params: { column: baseName },
        });
      } else if (!row.isInsert && field.entityProperty in (row.existingEntity ?? {})) {
        row.parsed[field.entityProperty] = row.existingEntity[field.entityProperty];
      }
      return;
    }

    for (let i = 0; i < columns.length; i++) {
      const colName = columns[i];
      const cell = cells[i];
      if (cell.kind !== 'value') continue;
      const rawValue = cell.text;

      // Resolve FK if needed
      if (field.fkEntity) {
        const found = this.findReference(field.fkEntity, colName, rawValue, row, context);
        if (found && 'id' in found) {
          values.push(found.id);
        } else if (found) {
          row.errors.push({
            row: row.rowNumber,
            column: colName,
            ...this.ambiguity(field.fkEntity, rawValue, found.many),
          });
        } else if (field.fkRequired) {
          row.errors.push({
            row: row.rowNumber,
            column: colName,
            message: `${field.fkEntity} not found: "${rawValue}"`,
            code: 'CSV_REFERENCE_NOT_FOUND',
            params: { value: rawValue },
          });
        } else {
          row.warnings.push({
            row: row.rowNumber,
            column: colName,
            message: `${field.fkEntity} not found: "${rawValue}" (skipped)`,
            code: 'CSV_REFERENCE_NOT_FOUND_SKIPPED',
            params: { value: rawValue },
          });
        }
      } else {
        values.push(rawValue);
      }
    }

    // Required validation: a new record needs a value (a stored list keeps itself, keepStoredReferences).
    if (field.required && values.length === 0 && row.isInsert) {
      row.errors.push({
        row: row.rowNumber,
        column: `${baseName}_1`,
        message: `At least one ${baseName} is required`,
        code: 'CSV_VALUE_ONE_REQUIRED',
        params: { column: baseName },
      });
      return;
    }

    row.parsed[field.entityProperty] = values;
  }

  /**
   * Get raw value from row, handling aliases and numbered columns.
   */
  private getRawValue(field: CsvFieldDefinition, raw: Record<string, string>): string {
    return (raw[field.csvColumn] ?? '').trim();
  }

  /**
   * A cell that finds the record (the id, a column of the matching key): its value, the text "-" of
   * a `'-` included; nothing for a blank cell or a `-`, which never finds a record (`-` on a key is
   * refused by parseField).
   */
  private keyText(raw: Record<string, string>, column: string): string {
    const cell = importCell(raw, column);
    return cell.kind === 'value' ? cell.text : '';
  }

  /** Whether the file holds the column: a blank cell is there, a column left out is not. */
  private hasColumn(raw: Record<string, string>, csvColumn: string): boolean {
    return Object.prototype.hasOwnProperty.call(raw, csvColumn);
  }

  /**
   * The clearing rule: the stored columns of the table. A property that names no stored column (one
   * the hooks or the entity service read) is cleared to null.
   *
   * The rules come from the database, not from the entity metadata: the database decides what
   * a write accepts, and the two disagree (portfolio_projects.priority_override and
   * criteria_values are nullable columns declared NOT NULL on the entity; tenant_id has a
   * default the entity does not declare).
   */
  private async loadClearRules(config: CsvEntityConfig, manager: EntityManager): Promise<ClearRules> {
    const rows = await manager.query(
      `SELECT column_name, is_nullable, data_type, column_default
         FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = $1`,
      [config.tableName],
    );
    const columns = new Map<string, StoredColumn>();
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row?.column_name) continue;
      const nullable = row.is_nullable === 'YES';
      const fallback = String(row.column_default ?? '');
      let empty: StoredColumn['empty'];
      if (!nullable && row.data_type === 'ARRAY') empty = () => [];
      else if (!nullable && row.data_type === 'jsonb' && /^'\[\]'::jsonb$/.test(fallback)) empty = () => [];
      else if (!nullable && row.data_type === 'jsonb' && /^'\{\}'::jsonb$/.test(fallback)) empty = () => ({});
      columns.set(row.column_name, { nullable, numeric: NUMERIC_TYPES.has(row.data_type), empty });
    }
    if (columns.size === 0) {
      throw new Error(`The import cannot read the columns of the table "${config.tableName}".`);
    }
    return { columns, cleared: new WeakMap(), nestedCleared: new WeakMap() };
  }

  /**
   * `-` on a record the row updates: the empty list or object of a NOT NULL list column, null
   * otherwise. NOT NULL columns without an empty value are refused once the hooks ran
   * (checkClearedColumns).
   */
  private clearField(property: string, csvColumn: string, row: CsvImportRow, rules: ClearRules, counted = true): void {
    const value = rules.columns.get(property)?.empty?.() ?? null;
    row.parsed[property] = value;
    let cleared = rules.cleared.get(row);
    if (!cleared) rules.cleared.set(row, (cleared = new Map()));
    cleared.set(property, { csvColumn, value, counted });
  }

  /**
   * Once the hooks ran, for the properties `-` cleared and no hook changed: a NOT NULL column with
   * no empty value is a row error naming the column (`CSV_NUMBER_CANNOT_BE_CLEARED` for a number:
   * write 0). Rows an insert-only import skips are not checked. It runs after afterValidate, at the
   * preflight as at the load; beforeCommit never runs at the preflight (it locks rows and allocates
   * references), so a rule that gives a cleared cell its value belongs in afterValidate.
   */
  private checkClearedColumns(rows: CsvImportRow[], rules: ClearRules, operation: CsvImportParams['operation']): void {
    for (const row of rows) {
      const cleared = rules.cleared.get(row);
      if (!cleared) continue;
      if (operation === 'insert_only' && !row.isInsert) continue;
      for (const [property, { csvColumn, value }] of cleared) {
        if (row.parsed[property] !== value) continue;
        const column = rules.columns.get(property);
        if (value !== null || !column || column.nullable) continue;
        refuseClear(row, csvColumn, { number: column.numeric });
      }
    }
  }

  /**
   * The stored values a row clears (`CsvImportResult.cleared`): each value `-` cleared that was not
   * already empty (the entries of a stored list), the nested sub-values `-` cleared, the stored
   * entries a filled list no longer holds, and what the config's hooks declared (`noteCleared`).
   */
  private clearedValues(row: CsvImportRow, fields: CsvFieldDefinition[], rules: ClearRules | null): number {
    const stored = row.existingEntity ?? {};
    let count = row.clearedByConfig ?? 0;
    const cleared = rules?.cleared.get(row);
    for (const [property, { value, counted }] of cleared ?? []) {
      if (!counted || row.parsed[property] !== value || !(property in stored)) continue;
      const before = stored[property];
      if (Array.isArray(before)) count += removedEntries(before, []);
      else if (!sameStoredValue(before, value)) count += 1;
    }
    count += rules?.nestedCleared.get(row) ?? 0;
    const lists = new Set(fields
      .filter((field) => field.type === CsvFieldType.ARRAY && !cleared?.has(field.entityProperty))
      .map((field) => field.entityProperty));
    for (const property of lists) {
      const next = row.parsed[property];
      if (Array.isArray(next) && Array.isArray(stored[property])) count += removedEntries(stored[property], next);
    }
    return count;
  }

  /**
   * Parse a value based on field type.
   */
  private parseValue(
    field: CsvFieldDefinition,
    rawValue: string,
    row: CsvImportRow,
    context: CsvImportContext,
  ): any {
    // Custom transform function
    if (field.importTransformFn) {
      return field.importTransformFn(rawValue, row.raw, context, row.rowNumber);
    }

    switch (field.type) {
      case CsvFieldType.STRING:
        return rawValue;

      case CsvFieldType.NUMBER:
        return this.parseNumber(rawValue, field.csvColumn);

      case CsvFieldType.DATE:
        return this.parseDate(rawValue, field.csvColumn);

      case CsvFieldType.ENUM:
        return this.parseEnum(rawValue, field, context.language);

      case CsvFieldType.ARRAY:
        // Comma-separated arrays
        return rawValue
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s !== '');

      case CsvFieldType.FK_BY_EMAIL:
      case CsvFieldType.FK_BY_NAME:
      case CsvFieldType.FK_BY_CODE:
        return this.parseFk(rawValue, field, row, context);

      case CsvFieldType.JSON:
        return this.parseJson(rawValue, field, row, context);

      case CsvFieldType.NESTED:
        // Nested values are handled separately in commit phase
        return rawValue;

      case CsvFieldType.BOOLEAN:
        return this.parseBoolean(rawValue, field.csvColumn);

      case CsvFieldType.COMPUTED:
        // Computed fields are normally export-only, but some are importable
        // (e.g. related_object_name resolved in beforeCommit hooks)
        if (field.importable) return rawValue;
        return undefined;

      default:
        return rawValue;
    }
  }

  /**
   * Parse a number value.
   */
  private parseNumber(value: string, columnName: string): number {
    // Handle European number format (comma as decimal separator)
    let normalized = value.replace(/\s+/g, '');
    const hasComma = normalized.includes(',');
    const hasDot = normalized.includes('.');

    if (hasComma && hasDot) {
      // 1.234,56 format -> 1234.56
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else if (hasComma && !hasDot) {
      // 1234,56 format -> 1234.56
      normalized = normalized.replace(',', '.');
    }

    const num = Number(normalized);
    if (isNaN(num)) {
      throw new CsvCellError('CSV_NUMBER_INVALID', `Invalid number in ${columnName}: "${value}"`, { value });
    }
    return num;
  }

  /**
   * Parse a date value: year first (`YYYY-MM-DD`, also `YYYY-M-D`, `YYYY/MM/DD`, `YYYY.MM.DD`,
   * with an optional time after it that is ignored) or day first (`D/M/YYYY`, `D.M.YYYY`). The
   * day is read from its year, month and day as written, with no time zone. A day that is not on
   * the calendar (`31/02/2025`, `2025/02/31`) is refused here, before a row reaches the database:
   * PostgreSQL would abort the whole import transaction. Any other form is refused.
   */
  private parseDate(value: string, columnName: string): string {
    const invalid = (): never => {
      throw new CsvCellError('CSV_DATE_INVALID', `Invalid date in ${columnName}: "${value}"`, { value });
    };
    const calendarDay = (year: string, month: string, day: string): string => {
      const y = Number(year);
      const m = Number(month);
      const d = Number(day);
      const date = new Date(Date.UTC(y, m - 1, d));
      const real = Number.isInteger(y) && m >= 1 && m <= 12 && d >= 1 && d <= 31
        && date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
      if (!real) invalid();
      return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    };
    const text = value.trim();

    // Year first, one separator throughout; a time after the day (`T10:00:00Z`) is not read.
    const yearFirst = text.match(/^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})(?:[T ].*)?$/);
    if (yearFirst) return calendarDay(yearFirst[1], yearFirst[3], yearFirst[4]);

    // Day first (DD/MM/YYYY or DD.MM.YYYY)
    const dayFirst = text.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/);
    if (dayFirst) return calendarDay(dayFirst[3], dayFirst[2], dayFirst[1]);

    return invalid();
  }

  /**
   * Parse a boolean value.
   */
  private parseBoolean(value: string, columnName: string): boolean {
    // Yes or no in any language, or the true/false and 1/0 of older files. A blank cell is no.
    const parsed = parseCsvBoolean(value);
    if (parsed !== undefined) return parsed ?? false;
    throw new CsvCellError(
      'CSV_BOOLEAN_INVALID',
      `Invalid boolean in ${columnName}: "${value}". Use yes or no.`,
      { value },
    );
  }

  /**
   * Parse an enum value: its code, whatever its case, or, for a list the screens name
   * (`labelsForEnum`), its name in any of the four languages. A value of neither is refused with the
   * names of the file's language (lot I2 of 26.11.9), the codes for a list the screens do not name.
   */
  private parseEnum(value: string, field: CsvFieldDefinition, language?: CsvLanguage): string {
    if (!field.enumValues) {
      return value;
    }

    const normalized = value.toLowerCase();
    const match = field.enumValues.find((v) => v.toLowerCase() === normalized);
    if (match) return match;

    const labels = labelsForEnum(field.enumValues);
    const named = labels && Object.values(labels)
      .flatMap((names) => Object.entries(names))
      .find(([, name]) => name.toLowerCase() === normalized.trim());
    if (named) return named[0];

    const allowed = field.enumValues.map((code) => labels?.[language ?? 'en']?.[code] ?? code).join(', ');
    throw new CsvCellError(
      'CSV_ENUM_INVALID',
      `Invalid ${field.csvColumn}: "${value}". Valid values: ${allowed}`,
      { value, allowed },
    );
  }

  /**
   * Parse a foreign key value.
   */
  private parseFk(
    value: string,
    field: CsvFieldDefinition,
    row: CsvImportRow,
    context: CsvImportContext,
  ): string | null {
    if (!field.fkEntity) {
      return value;
    }

    const found = this.findReference(field.fkEntity, field.csvColumn, value, row, context, field.nameMatchedByConfig === true);
    if (found && 'many' in found) {
      const { code, message, params } = this.ambiguity(field.fkEntity, value, found.many);
      throw new CsvCellError(code, message, params);
    }
    const resolved = found?.id ?? null;

    if (!resolved) {
      if (field.fkRequired) {
        throw new CsvCellError('CSV_REFERENCE_NOT_FOUND', `${field.fkEntity} not found: "${value}"`, { value });
      } else {
        row.warnings.push({
          row: row.rowNumber,
          column: field.csvColumn,
          message: `${field.fkEntity} not found: "${value}" (set to null)`,
          code: 'CSV_REFERENCE_NOT_FOUND_CLEARED',
          params: { value },
        });
        return null;
      }
    }

    return resolved;
  }

  /**
   * The record a reference cell names (lot I3 of 26.11.9): by its name case aside, as before; beyond
   * (accents set aside, a shipped name in another language) when the person reads the family and has
   * not undone that value (`params.unmatched`). A match beyond case is noted for the result. Kad's
   * proposal for the value comes first (`params.proposals`): the record it names, exactly or case
   * aside, in a family the person reads, is a match of origin model, unless the cell finds that very
   * record by its own name (then the server's match, lot I6b of 26.12.1); otherwise the proposal is noted
   * as refused, naming nothing of the family, and the cell is found by its own name. `byConfig` (a
   * field the config matches itself, `nameMatchedByConfig`): case aside only, no proposal.
   */
  private findReference(
    fkEntity: string,
    column: string,
    value: string,
    row: CsvImportRow,
    context: CsvImportContext,
    byConfig = false,
  ): ReferenceLookup {
    const undone = byConfig || undoneMatch(context.params.unmatched, column, value);
    const reads = this.resolver.matchesBeyondCase(fkEntity, context.access);
    const proposal = undone ? undefined : proposalFor(context.params.proposals, column, value);
    if (proposal !== undefined) {
      const target = reads ? this.resolver.resolveName(fkEntity, proposal, context.resolverCache, { beyondCase: false }) : null;
      // The server's own match first (lot I6b of 26.12.1): Kad naming the record the value finds alone
      // is no proposal to list, taken or refused; the value follows its own rule below.
      const own = target?.kind === 'one' ? this.resolver.resolveName(fkEntity, value, context.resolverCache, { beyondCase: true }) : null;
      const same = target?.kind === 'one' && own?.kind === 'one' && own.entry.id === target.entry.id;
      if (target?.kind === 'one' && !same) {
        if (context.nameMatches) {
          noteNameMatch(context.nameMatches, {
            column, name: null, value: value.trim(), target: target.target, ref: target.ref, origin: 'model', reason: 'model', undoable: true,
          }, row.rowNumber);
        }
        return { id: target.entry.id };
      }
      if (!same && context.refusedProposals) {
        noteRefusedProposal(context.refusedProposals, { column, name: null, value: value.trim(), target: proposal, reason: 'missing' }, row.rowNumber);
      }
    }
    const beyondCase = !undone && reads;
    const found = this.resolver.resolveName(fkEntity, value, context.resolverCache, { beyondCase });
    if (found.kind === 'none') return null;
    if (found.kind === 'many') return { many: found.names };
    if (found.how === 'accents' || found.how === 'translation') {
      if (undone) return null;
      if (context.nameMatches) {
        noteNameMatch(context.nameMatches, {
          column,
          name: null,
          value: value.trim(),
          target: found.target,
          ref: found.ref,
          origin: 'server',
          reason: found.how,
          undoable: true,
        }, row.rowNumber);
      }
    }
    return { id: found.entry.id };
  }

  /** A name that may designate several records, named by their references, else their names. */
  private ambiguity(fkEntity: string, value: string, names: string[]): { code: string; message: string; params: Record<string, string> } {
    const listed = names.join(', ');
    return {
      code: 'CSV_NAME_AMBIGUOUS_AMONG',
      message: `${fkEntity} "${value}" may designate several records: ${listed}`,
      params: { value, names: listed },
    };
  }

  /**
   * Parse a JSON value with optional validation.
   */
  private parseJson(
    value: string,
    field: CsvFieldDefinition,
    row: CsvImportRow,
    context: CsvImportContext,
  ): any {
    let parsed: any;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new CsvCellError('CSV_JSON_INVALID', `Invalid JSON in ${field.csvColumn}`);
    }

    return parsed;
  }

  /**
   * Run async JSON validators on a parsed row.
   */
  private async runJsonValidators(
    row: CsvImportRow,
    fields: CsvFieldDefinition[],
    context: CsvImportContext,
  ): Promise<void> {
    for (const field of fields) {
      if (field.type === CsvFieldType.JSON && field.jsonValidator) {
        const value = row.parsed[field.entityProperty];
        if (value !== null && value !== undefined) {
          const errors = await this.jsonValidators.validate(
            field.jsonValidator,
            value,
            context.tenantId,
            context.manager,
          );

          for (const err of errors) {
            row.errors.push({ row: row.rowNumber, column: field.csvColumn, ...err });
          }
        }
      }
    }
  }

  /**
   * Load existing entities for identity resolution.
   */
  private async loadExistingEntities(
    config: CsvEntityConfig,
    rows: Record<string, string>[],
    context: CsvImportContext,
  ): Promise<{ entities: Map<string, any>; deleted: Set<string> }> {
    const entities = new Map<string, any>();

    // Get ID field
    const idField = config.fields.find((f) => f.isIdentityColumn);

    // Collect IDs and upsert keys from rows
    const ids: string[] = [];
    const upsertKeys: string[][] = [];

    for (const row of rows) {
      // Check for ID
      if (idField) {
        const id = this.keyText(row, idField.csvColumn);
        if (id) {
          ids.push(id);
        }
      }

      // Build upsert key values
      if (config.upsertKey.length > 0) {
        const keyValues: string[] = [];
        for (const keyField of config.upsertKey) {
          const field = config.fields.find((f) => f.entityProperty === keyField);
          if (field) {
            keyValues.push(this.keyText(row, field.csvColumn).toLowerCase());
          }
        }
        if (keyValues.length === config.upsertKey.length && keyValues.every((v) => v)) {
          upsertKeys.push(keyValues);
        }
      }
    }

    // Load by ID
    if (ids.length > 0) {
      const byId = await context.manager.query(
        `SELECT * FROM ${config.tableName} WHERE tenant_id = $1 AND id = ANY($2)`,
        [context.tenantId, ids],
      );
      for (const entity of byId) {
        entities.set(`id:${entity.id}`, entity);
      }
    }

    // Load by upsert key
    if (upsertKeys.length > 0 && config.upsertKey.length > 0) {
      // Build query dynamically based on upsert key fields
      const column = (key: string) => (config.upsertKeyIgnoresOuterSpaces ? `BTRIM(${key}::text)` : `${key}::text`);
      const conditions = config.upsertKey
        .map((key, i) => `LOWER(${column(key)}) = ANY($${i + 2})`)
        .join(' AND ');

      const params: any[] = [context.tenantId];
      for (let i = 0; i < config.upsertKey.length; i++) {
        const values = upsertKeys.map((k) => k[i]);
        params.push(values);
      }

      const byKey = await context.manager.query(
        `SELECT * FROM ${config.tableName} WHERE tenant_id = $1 AND ${conditions}`,
        params,
      );

      for (const entity of byKey) {
        // The stored value read as the query compared it (`BTRIM` removes the space character only).
        const keyStr = config.upsertKey
          .map((k) => {
            const value = String(entity[k] ?? '');
            return (config.upsertKeyIgnoresOuterSpaces ? value.replace(/^ +| +$/g, '') : value).toLowerCase();
          })
          .join('|');
        entities.set(`key:${keyStr}`, entity);
      }
    }

    const deleted = context.params.dryRun ? new Set<string>() : await this.lockExistingEntities(config, entities, context);
    return { entities, deleted };
  }

  /**
   * The load works from records nobody changes before it commits (lot I6 of 26.11.9, passes F and G):
   * the records the file finds are locked `FOR NO KEY UPDATE` and read again, in one statement in the
   * order of their ids (two loads that cross the same records wait for each other, never deadlock), in
   * the load's transaction. Every value the import keeps or derives (a blank cell, a column the file
   * leaves out, a hook's rule) then comes from the record as it is when written, and a change or a
   * delete saved on the screen during the load waits for it, then applies. The lock leaves the
   * record's key alone, as the update itself does: rows that reference the record (time entries,
   * attachments, activities) are saved without waiting. A record deleted since the first read is
   * returned in `deleted`: its row is refused (`CSV_RECORD_DELETED`), never inserted again. The check
   * (`dryRun`) locks nothing.
   */
  private async lockExistingEntities(config: CsvEntityConfig, entities: Map<string, any>, context: CsvImportContext): Promise<Set<string>> {
    const ids = [...new Set([...entities.values()].map((entity) => String(entity.id)))].sort();
    if (ids.length === 0) return new Set();
    const locked: any[] = await context.manager.query(
      `SELECT * FROM ${config.tableName} WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR NO KEY UPDATE`,
      [context.tenantId, ids],
    );
    const fresh = new Map(locked.map((entity) => [String(entity.id), entity]));
    for (const [key, entity] of entities) entities.set(key, fresh.get(String(entity.id)) ?? entity);
    return new Set(ids.filter((id) => !fresh.has(id)));
  }

  /**
   * Resolve identity for a row.
   */
  private resolveIdentity(
    config: CsvEntityConfig,
    raw: Record<string, string>,
    existingEntities: Map<string, any>,
  ): any | null {
    // Check ID first
    const idField = config.fields.find((f) => f.isIdentityColumn);
    if (idField) {
      const id = this.keyText(raw, idField.csvColumn);
      if (id) {
        const byId = existingEntities.get(`id:${id}`);
        if (byId) {
          return byId;
        }
      }
    }

    // Check upsert key
    if (config.upsertKey.length > 0) {
      const keyValues: string[] = [];
      for (const keyField of config.upsertKey) {
        const field = config.fields.find((f) => f.entityProperty === keyField);
        if (field) {
          keyValues.push(this.keyText(raw, field.csvColumn).toLowerCase());
        }
      }

      if (keyValues.length === config.upsertKey.length && keyValues.every((v) => v)) {
        const keyStr = keyValues.join('|');
        const byKey = existingEntities.get(`key:${keyStr}`);
        if (byKey) {
          return byKey;
        }
      }
    }

    return null;
  }

  /**
   * Check for duplicate upsert keys within the import file.
   */
  private checkDuplicateKeys(
    config: CsvEntityConfig,
    rows: CsvImportRow[],
  ): CsvImportError[] {
    const errors: CsvImportError[] = [];
    const seen = new Map<string, number>();

    if (config.upsertKey.length === 0) {
      return errors;
    }
    const keyColumns = config.upsertKey
      .map((key) => config.fields.find((f) => f.entityProperty === key)?.csvColumn ?? key)
      .join(', ');

    for (const row of rows) {
      const keyValues: string[] = [];
      for (const keyField of config.upsertKey) {
        const value = row.parsed[keyField];
        keyValues.push(String(value ?? '').toLowerCase());
      }

      const keyStr = keyValues.join('|');
      const firstRow = seen.get(keyStr);

      if (firstRow !== undefined) {
        errors.push({
          row: row.rowNumber,
          message: `Duplicate key [${config.upsertKey.join(', ')}]: same values as row ${firstRow}`,
          code: 'CSV_DUPLICATE_KEY',
          params: { columns: keyColumns, firstRow },
        });
      } else if (keyValues.every((v) => v)) {
        seen.set(keyStr, row.rowNumber);
      }
    }

    return errors;
  }

  /**
   * Commit changes to the database.
   */
  private async commitChanges(
    config: CsvEntityConfig,
    rows: CsvImportRow[],
    context: CsvImportContext,
  ): Promise<void> {
    const repo = context.manager.getRepository(config.tableName);
    const entitiesToSave: any[] = [];
    // The record each written row saves, for its relation handlers: rows the import does not write
    // (unchanged, or left out by the operation) have none.
    const written: Array<{ row: CsvImportRow; entity: any }> = [];
    const persistedRows: Array<{
      action: 'create' | 'update';
      before: any | null;
    }> = [];

    for (const row of rows) {
      if (row.errors.length > 0 || row.leftOut) {
        continue;
      }

      // Skip based on operation
      if (row.isInsert && context.params.operation === 'update_only') {
        continue;
      }
      if (!row.isInsert && context.params.operation === 'insert_only') {
        continue;
      }
      if (row.unchanged) {
        continue;
      }

      let entity: any;

      if (row.isInsert) {
        // Create new entity
        entity = {
          ...row.parsed,
          tenant_id: context.tenantId,
        };
      } else {
        // Update existing entity
        entity = {
          ...row.existingEntity,
          ...row.parsed,
          updated_at: new Date(),
        };
      }

      entitiesToSave.push(entity);
      written.push({ row, entity });
      persistedRows.push({
        action: row.isInsert ? 'create' : 'update',
        before: row.isInsert ? null : row.existingEntity ?? null,
      });
    }

    // Call beforeCommit hook
    if (config.beforeCommit) {
      await config.beforeCommit(entitiesToSave, context);
    }

    // Save all entities
    if (entitiesToSave.length > 0) {
      await repo.save(entitiesToSave);
      await this.logAuditForTrackedImports(config.tableName, entitiesToSave, persistedRows, context);
    }

    // Handle relation handlers
    if (config.relationHandlers) {
      for (const handler of config.relationHandlers) {
        for (const { row, entity } of written) {
          await handler.importHandler(entity, row.raw, context);
        }
      }
    }

    // Call afterCommit hook
    if (config.afterCommit) {
      await config.afterCommit(entitiesToSave, context, written);
    }
  }

  private async logAuditForTrackedImports(
    tableName: string,
    entities: any[],
    persistedRows: Array<{ action: 'create' | 'update'; before: any | null }>,
    context: CsvImportContext,
  ): Promise<void> {
    if (!this.AUDITED_IMPORT_TABLES.has(tableName)) return;
    if (entities.length === 0 || persistedRows.length === 0) return;

    // As a write on the record's page: the row names its parent record (a task, its project or
    // contract), so that record's history shows it too; the source is Kad's card, else the person.
    const entries = entities.flatMap((entity, i) => {
      const meta = persistedRows[i];
      if (!entity?.id || !meta) return [];
      return [{
        table: tableName,
        recordId: entity.id,
        action: meta.action,
        before: meta.before,
        after: entity,
        userId: context.userId ?? null,
        source: context.audit?.source,
        sourceRef: context.audit?.sourceRef ?? null,
      }];
    });
    await writeAuditLogs(context.manager, entries);
  }
}
