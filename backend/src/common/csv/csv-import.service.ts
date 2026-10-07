import { Injectable, BadRequestException } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { parseString } from '@fast-csv/parse';
import { decodeCsvBufferUtf8OrThrow } from '../encoding';
import { AuditLog } from '../../audit/audit.entity';
import { omitAuditSecrets } from '../../audit/audit.service';
import {
  ArrayStrategy,
  CsvEntityConfig,
  CsvFieldDefinition,
  CsvFieldType,
  CsvImportContext,
  CsvImportError,
  CsvImportParams,
  CsvImportResult,
  CsvImportRow,
  CsvImportWarning,
} from './csv-field.types';
import { CsvResolverService } from './csv-resolver.service';
import { denormalizeCsvFormulaValue } from './csv-export.service';
import { CsvJsonValidators } from './csv-json-validators';

/**
 * Import options
 */
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
}

/**
 * Service for importing entities from CSV format.
 *
 * Features:
 * - Two-phase import: validate all rows, then commit
 * - Identity resolution (id column or natural key)
 * - FK resolution with preloading
 * - enrich vs replace modes
 * - insert_only, update_only, upsert operations
 * - Duplicate detection within same file
 */
@Injectable()
export class CsvImportService {
  /** CSV delimiter */
  private readonly DELIMITER = ';';
  /** Default max items for array fields */
  private readonly DEFAULT_MAX_ITEMS = 4;
  private readonly AUDITED_IMPORT_TABLES = new Set<string>([
    'tasks',
    'incidents',
    'applications',
    'portfolio_requests',
    'portfolio_projects',
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
   * @param params - Import parameters (dryRun, mode, operation)
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
    const { rows, headerErrors } = await this.parseCsv(config, file);

    // Early return if header errors
    if (headerErrors.length > 0) {
      return {
        ok: false,
        dryRun: params.dryRun,
        total: 0,
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: headerErrors,
        warnings: [],
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
    };

    // Phase 1: Validate and parse all rows
    const parsedRows = await this.validateAndParseRows(config, rows, importFields, context);

    if (config.afterValidate) await config.afterValidate(parsedRows, context);

    // Check for duplicate upsert keys within the file
    const duplicateErrors = this.checkDuplicateKeys(config, parsedRows);

    // Collect all errors
    const allErrors: CsvImportError[] = [];
    const allWarnings: CsvImportWarning[] = [];

    for (const row of parsedRows) {
      allErrors.push(...row.errors);
      allWarnings.push(...row.warnings);
    }
    allErrors.push(...duplicateErrors);

    // Count operations
    let insertCount = 0;
    let updateCount = 0;
    let skipCount = 0;

    for (const row of parsedRows) {
      if (row.errors.length > 0) {
        skipCount++;
        continue;
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
        } else {
          updateCount++;
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
        errors: allErrors,
        warnings: allWarnings,
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
        errors: [{ row: 0, message: `Import failed: ${error.message}` }],
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
      errors: [],
      warnings: allWarnings,
    };
  }

  /**
   * Parse CSV file and validate headers.
   */
  private async parseCsv(
    config: CsvEntityConfig,
    file: Express.Multer.File,
  ): Promise<{ rows: Record<string, string>[]; headerErrors: CsvImportError[] }> {
    const buf = file.buffer ?? (file as any).path;
    if (!buf) {
      throw new BadRequestException('No file uploaded');
    }

    let content: string;
    try {
      content = decodeCsvBufferUtf8OrThrow(
        typeof buf === 'string' ? require('fs').readFileSync(buf) : buf,
      );
    } catch {
      throw new BadRequestException(
        'Invalid file encoding. Please save the CSV as UTF-8 and use semicolons as separators.',
      );
    }

    const rows: Record<string, string>[] = [];
    const headerErrors: CsvImportError[] = [];

    // Get expected headers for importable fields
    const expectedHeaders = this.getExpectedHeaders(config);

    await new Promise<void>((resolve, reject) => {
      parseString(content, {
        headers: true,
        delimiter: this.DELIMITER,
        ignoreEmpty: true,
        trim: true,
      })
        .on('headers', (headers: string[]) => {
          // Validate headers
          const missing = expectedHeaders.required.filter((h) => !headers.includes(h));
          const extra = headers.filter(
            (h) => !expectedHeaders.all.has(h) && !h.startsWith('_'),
          );

          if (missing.length > 0) {
            headerErrors.push({
              row: 0,
              message: `Missing required columns: ${missing.join(', ')}`,
            });
          }

          if (extra.length > 0) {
            headerErrors.push({
              row: 0,
              message: `Unknown columns (will be ignored): ${extra.join(', ')}`,
            });
          }
        })
        .on('error', (err) => reject(err))
        .on('data', (row: Record<string, string>) => {
          // Strip the protective apostrophe our export prepends to
          // formula-like values, so export -> import round-trips cleanly.
          for (const key of Object.keys(row)) {
            row[key] = denormalizeCsvFormulaValue(row[key]);
          }
          rows.push(row);
        })
        .on('end', () => resolve());
    });

    return { rows, headerErrors };
  }

  /**
   * Get expected headers from config.
   */
  private getExpectedHeaders(config: CsvEntityConfig): {
    required: string[];
    all: Set<string>;
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
          // First column required if field is required
          if (i === 1 && field.required) {
            required.push(colName);
          }
        }
      } else if (!field.arrayIndex) {
        all.add(field.csvColumn);
        if (field.required) {
          required.push(field.csvColumn);
        }
      }
    }

    return { required, all };
  }

  /**
   * Validate and parse all rows.
   */
  private async validateAndParseRows(
    config: CsvEntityConfig,
    rows: Record<string, string>[],
    importFields: CsvFieldDefinition[],
    context: CsvImportContext,
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
    const existingEntities = await this.loadExistingEntities(config, rows, context);

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      const rowNumber = i + 2; // 1-based, accounting for header

      const parsedRow: CsvImportRow = {
        rowNumber,
        raw,
        parsed: {},
        isInsert: true,
        errors: [...(preliminaryRows[i]?.errors ?? [])],
        warnings: [...(preliminaryRows[i]?.warnings ?? [])],
      };

      // Parse and validate each field
      for (const field of importFields) {
        this.parseField(field, raw, parsedRow, context);
      }

      // Resolve identity
      const existingEntity = this.resolveIdentity(config, raw, parsedRow, existingEntities);
      if (existingEntity) {
        parsedRow.existingEntity = existingEntity;
        parsedRow.isInsert = false;
      }

      // Assemble NESTED fields into their parent objects
      this.assembleNestedFields(importFields, raw, parsedRow);

      // Apply enrich mode: preserve existing values for empty cells
      if (context.params.mode === 'enrich' && existingEntity) {
        for (const field of importFields) {
          // Skip nested fields here - they're handled separately below
          if (field.type === CsvFieldType.NESTED) {
            continue;
          }
          const rawValue = this.getRawValue(field, raw);
          if ((rawValue === '' || rawValue === null) && field.entityProperty in existingEntity) {
            parsedRow.parsed[field.entityProperty] = existingEntity[field.entityProperty];
          }
        }

        // Handle nested fields: merge CSV values with existing array entries
        this.mergeNestedFieldsForEnrich(importFields, raw, parsedRow, existingEntity);
      }

      // Run async JSON validators
      await this.runJsonValidators(parsedRow, importFields, context);

      parsedRows.push(parsedRow);
    }

    return parsedRows;
  }

  /**
   * Parse a single field from the raw row.
   */
  private parseField(
    field: CsvFieldDefinition,
    raw: Record<string, string>,
    row: CsvImportRow,
    context: CsvImportContext,
  ): void {
    // Handle numbered column arrays
    if (
      field.type === CsvFieldType.ARRAY &&
      field.arrayStrategy === ArrayStrategy.NUMBERED_COLUMNS
    ) {
      this.parseNumberedArrayField(field, raw, row, context);
      return;
    }

    // Skip array index fields (handled by parseNumberedArrayField)
    if (field.arrayIndex) {
      return;
    }

    // Skip NESTED fields (handled by assembleNestedFields)
    if (field.type === CsvFieldType.NESTED) {
      return;
    }

    const rawValue = this.getRawValue(field, raw);

    // Required validation
    if (field.required && (rawValue === '' || rawValue === null)) {
      row.errors.push({
        row: row.rowNumber,
        column: field.csvColumn,
        message: `${field.csvColumn} is required`,
      });
      return;
    }

    // Empty value handling
    if (rawValue === '' || rawValue === null) {
      if (context.params.mode === 'replace') {
        row.parsed[field.entityProperty] = null;
      }
      // In enrich mode, empty cells are handled after identity resolution
      return;
    }

    // Parse based on type
    try {
      const parsedValue = this.parseValue(field, rawValue, row, context);
      if (parsedValue !== undefined) {
        row.parsed[field.entityProperty] = parsedValue;
      }
    } catch (error: any) {
      row.errors.push({
        row: row.rowNumber,
        column: field.csvColumn,
        message: error.message,
      });
    }
  }

  /**
   * Assemble NESTED fields into their parent objects.
   * Handles paths like [0].type, [1].ip into arrays of objects.
   */
  private assembleNestedFields(
    fields: CsvFieldDefinition[],
    raw: Record<string, string>,
    row: CsvImportRow,
  ): void {
    // Group NESTED fields by entityProperty
    const nestedFields = fields.filter((f) => f.type === CsvFieldType.NESTED && f.nestedPath);
    const byProperty = new Map<string, CsvFieldDefinition[]>();

    for (const field of nestedFields) {
      const prop = field.entityProperty;
      if (!byProperty.has(prop)) {
        byProperty.set(prop, []);
      }
      byProperty.get(prop)!.push(field);
    }

    // Assemble each nested property
    for (const [prop, propFields] of byProperty) {
      const result: any[] = [];

      // Find max array index
      let maxIndex = -1;
      for (const field of propFields) {
        const match = field.nestedPath!.match(/^\[(\d+)\]/);
        if (match) {
          maxIndex = Math.max(maxIndex, parseInt(match[1], 10));
        }
      }

      // Build array entries
      for (let i = 0; i <= maxIndex; i++) {
        const entry: Record<string, any> = {};
        let hasValue = false;

        for (const field of propFields) {
          const pathMatch = field.nestedPath!.match(/^\[(\d+)\]\.(.+)$/);
          if (pathMatch && parseInt(pathMatch[1], 10) === i) {
            const subProp = pathMatch[2];
            const rawValue = (raw[field.csvColumn] ?? '').trim();
            if (rawValue !== '') {
              entry[subProp] = rawValue;
              hasValue = true;
            }
          }
        }

        if (hasValue) {
          result.push(entry);
        }
      }

      // Only set if we have values (or clear if we're in replace mode)
      if (result.length > 0) {
        row.parsed[prop] = result;
      }
    }
  }

  /**
   * Merge nested fields with existing entity values in enrich mode.
   * This preserves existing array entries that weren't specified in CSV.
   */
  private mergeNestedFieldsForEnrich(
    fields: CsvFieldDefinition[],
    raw: Record<string, string>,
    row: CsvImportRow,
    existingEntity: any,
  ): void {
    // Group NESTED fields by entityProperty
    const nestedFields = fields.filter((f) => f.type === CsvFieldType.NESTED && f.nestedPath);
    const byProperty = new Map<string, CsvFieldDefinition[]>();

    for (const field of nestedFields) {
      const prop = field.entityProperty;
      if (!byProperty.has(prop)) {
        byProperty.set(prop, []);
      }
      byProperty.get(prop)!.push(field);
    }

    // Process each nested property
    for (const [prop, propFields] of byProperty) {
      const existingArray = existingEntity[prop];
      const csvArray = row.parsed[prop];

      // If no existing array, nothing to merge
      if (!Array.isArray(existingArray) || existingArray.length === 0) {
        continue;
      }

      // Check if ALL nested CSV columns for this property are empty
      const allCsvColumnsEmpty = propFields.every((field) => {
        const rawValue = (raw[field.csvColumn] ?? '').trim();
        return rawValue === '';
      });

      // If all CSV columns are empty, preserve the entire existing array
      if (allCsvColumnsEmpty) {
        row.parsed[prop] = existingArray;
        continue;
      }

      // Find max array index in the config
      let maxIndex = -1;
      for (const field of propFields) {
        const match = field.nestedPath!.match(/^\[(\d+)\]/);
        if (match) {
          maxIndex = Math.max(maxIndex, parseInt(match[1], 10));
        }
      }

      // Build merged array: CSV values take precedence, preserve existing entries beyond CSV range
      const mergedArray: any[] = [];

      for (let i = 0; i <= Math.max(maxIndex, existingArray.length - 1); i++) {
        const existingEntry = existingArray[i];
        const csvEntry = Array.isArray(csvArray) ? csvArray.find((_: any, idx: number) => {
          // Map sparse CSV array back to original indices
          // CSV array is built densely from entries with values, so we need to check
          // which original index each entry corresponds to
          return false; // We'll handle this differently
        }) : undefined;

        // Check if CSV has any values for this index
        let csvHasValuesAtIndex = false;
        const csvEntryForIndex: Record<string, any> = {};

        for (const field of propFields) {
          const pathMatch = field.nestedPath!.match(/^\[(\d+)\]\.(.+)$/);
          if (pathMatch && parseInt(pathMatch[1], 10) === i) {
            const subProp = pathMatch[2];
            const rawValue = (raw[field.csvColumn] ?? '').trim();
            if (rawValue !== '') {
              csvEntryForIndex[subProp] = rawValue;
              csvHasValuesAtIndex = true;
            }
          }
        }

        if (csvHasValuesAtIndex) {
          // CSV has values at this index - merge with existing (CSV takes precedence)
          if (existingEntry && typeof existingEntry === 'object') {
            mergedArray.push({ ...existingEntry, ...csvEntryForIndex });
          } else {
            mergedArray.push(csvEntryForIndex);
          }
        } else if (existingEntry) {
          // No CSV values at this index but existing entry exists - preserve it
          mergedArray.push(existingEntry);
        }
        // If neither CSV nor existing has values at this index, skip (don't add empty entry)
      }

      // Update parsed with merged result
      if (mergedArray.length > 0) {
        row.parsed[prop] = mergedArray;
      } else if (prop in row.parsed) {
        // CSV explicitly cleared, keep it cleared
      } else {
        row.parsed[prop] = existingArray;
      }
    }
  }

  /**
   * Parse a numbered array field (e.g., owner_email_1..4).
   */
  private parseNumberedArrayField(
    field: CsvFieldDefinition,
    raw: Record<string, string>,
    row: CsvImportRow,
    context: CsvImportContext,
  ): void {
    const baseName = field.csvColumn.replace(/_\d+$/, '');
    const maxItems = field.maxItems ?? this.DEFAULT_MAX_ITEMS;
    const values: any[] = [];

    for (let i = 1; i <= maxItems; i++) {
      const colName = `${baseName}_${i}`;
      const rawValue = (raw[colName] ?? '').trim();

      if (rawValue === '') {
        continue;
      }

      // Resolve FK if needed
      if (field.fkEntity) {
        const resolved = this.resolver.resolveId(
          field.fkEntity,
          rawValue,
          context.resolverCache,
        );
        if (resolved) {
          values.push(resolved);
        } else if (field.fkRequired) {
          row.errors.push({
            row: row.rowNumber,
            column: colName,
            message: `${field.fkEntity} not found: "${rawValue}"`,
          });
        } else {
          row.warnings.push({
            row: row.rowNumber,
            column: colName,
            message: `${field.fkEntity} not found: "${rawValue}" (skipped)`,
          });
        }
      } else {
        values.push(rawValue);
      }
    }

    // Required validation
    if (field.required && values.length === 0) {
      row.errors.push({
        row: row.rowNumber,
        column: `${baseName}_1`,
        message: `At least one ${baseName} is required`,
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
      return field.importTransformFn(rawValue, row.raw, context);
    }

    switch (field.type) {
      case CsvFieldType.STRING:
        return rawValue;

      case CsvFieldType.NUMBER:
        return this.parseNumber(rawValue, field.csvColumn);

      case CsvFieldType.DATE:
        return this.parseDate(rawValue, field.csvColumn);

      case CsvFieldType.ENUM:
        return this.parseEnum(rawValue, field);

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
      throw new Error(`Invalid number in ${columnName}: "${value}"`);
    }
    return num;
  }

  /**
   * Parse a date value.
   */
  private parseDate(value: string, columnName: string): string {
    // Try ISO format first
    const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    }

    // Try European format (DD/MM/YYYY or DD.MM.YYYY)
    const euroMatch = value.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/);
    if (euroMatch) {
      const day = euroMatch[1].padStart(2, '0');
      const month = euroMatch[2].padStart(2, '0');
      const year = euroMatch[3];
      return `${year}-${month}-${day}`;
    }

    // Try parsing as Date
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }

    throw new Error(`Invalid date in ${columnName}: "${value}"`);
  }

  /**
   * Parse a boolean value.
   */
  private parseBoolean(value: string, columnName: string): boolean {
    const normalized = value.toLowerCase().trim();
    if (['true', 'yes', '1', 'y', 'on'].includes(normalized)) {
      return true;
    }
    if (['false', 'no', '0', 'n', 'off', ''].includes(normalized)) {
      return false;
    }
    throw new Error(`Invalid boolean in ${columnName}: "${value}". Use true/false, yes/no, or 1/0.`);
  }

  /**
   * Parse an enum value.
   */
  private parseEnum(value: string, field: CsvFieldDefinition): string {
    if (!field.enumValues) {
      return value;
    }

    const normalized = value.toLowerCase();
    const match = field.enumValues.find((v) => v.toLowerCase() === normalized);

    if (!match) {
      throw new Error(
        `Invalid ${field.csvColumn}: "${value}". Valid values: ${field.enumValues.join(', ')}`,
      );
    }

    return match;
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

    const resolved = this.resolver.resolveId(field.fkEntity, value, context.resolverCache);

    if (!resolved) {
      if (field.fkRequired) {
        throw new Error(`${field.fkEntity} not found: "${value}"`);
      } else {
        row.warnings.push({
          row: row.rowNumber,
          column: field.csvColumn,
          message: `${field.fkEntity} not found: "${value}" (set to null)`,
        });
        return null;
      }
    }

    return resolved;
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
      throw new Error(`Invalid JSON in ${field.csvColumn}`);
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
            row.errors.push({
              row: row.rowNumber,
              column: field.csvColumn,
              message: err,
            });
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
  ): Promise<Map<string, any>> {
    const entities = new Map<string, any>();

    // Get ID field
    const idField = config.fields.find((f) => f.isIdentityColumn);

    // Collect IDs and upsert keys from rows
    const ids: string[] = [];
    const upsertKeys: string[][] = [];

    for (const row of rows) {
      // Check for ID
      if (idField) {
        const id = (row[idField.csvColumn] ?? '').trim();
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
            keyValues.push((row[field.csvColumn] ?? '').trim().toLowerCase());
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
      const conditions = config.upsertKey
        .map((key, i) => `LOWER(${key}::text) = ANY($${i + 2})`)
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
        const keyStr = config.upsertKey
          .map((k) => String(entity[k] ?? '').toLowerCase())
          .join('|');
        entities.set(`key:${keyStr}`, entity);
      }
    }

    return entities;
  }

  /**
   * Resolve identity for a row.
   */
  private resolveIdentity(
    config: CsvEntityConfig,
    raw: Record<string, string>,
    row: CsvImportRow,
    existingEntities: Map<string, any>,
  ): any | null {
    // Check ID first
    const idField = config.fields.find((f) => f.isIdentityColumn);
    if (idField) {
      const id = (raw[idField.csvColumn] ?? '').trim();
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
          keyValues.push((raw[field.csvColumn] ?? '').trim().toLowerCase());
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
    const persistedRows: Array<{
      action: 'create' | 'update';
      before: any | null;
    }> = [];

    for (const row of rows) {
      if (row.errors.length > 0) {
        continue;
      }

      // Skip based on operation
      if (row.isInsert && context.params.operation === 'update_only') {
        continue;
      }
      if (!row.isInsert && context.params.operation === 'insert_only') {
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
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (row.errors.length > 0) continue;

          const entity = entitiesToSave.find(
            (e) =>
              (row.existingEntity && e.id === row.existingEntity.id) ||
              (!row.existingEntity && e === entitiesToSave[i]),
          );

          if (entity) {
            await handler.importHandler(entity, row.raw, context);
          }
        }
      }
    }

    // Call afterCommit hook
    if (config.afterCommit) {
      await config.afterCommit(entitiesToSave, context);
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

    const auditRepo = context.manager.getRepository(AuditLog);
    const entries: AuditLog[] = [];

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      const meta = persistedRows[i];
      if (!entity || !meta) continue;
      if (!entity.id) continue;

      entries.push(
        auditRepo.create({
          tenant_id: context.tenantId,
          table_name: tableName,
          record_id: entity.id,
          action: meta.action,
          // Written without AuditService.log: the same keys are left out as there.
          before_json: omitAuditSecrets(meta.before),
          after_json: omitAuditSecrets(entity),
          user_id: context.userId ?? null,
        }),
      );
    }

    if (entries.length > 0) {
      await auditRepo.save(entries);
    }
  }
}
