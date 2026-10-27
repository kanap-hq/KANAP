import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { formatCsvBoolean } from '../csv-sheet/boolean';
import { formatCsvDate, timeZoneHeader } from '../csv-sheet/date';
import { csvProfile } from '../csv-sheet/language';
import { CsvLanguage } from '../csv-sheet/types';
import { writeCsvHeader, writeCsvRows } from '../csv-sheet/write';
import {
  ArrayStrategy,
  CsvEntityConfig,
  CsvExportContext,
  CsvExportResult,
  CsvFieldDefinition,
  CsvFieldType,
} from './csv-field.types';
import { CsvResolverService } from './csv-resolver.service';

const CSV_FORMULA_TRIGGER = /^[=+\-@\t\r\n]|^\s+[=+\-@]/;
// A plain negative amount ("-1200.50", "-1200,5") or share ("-3,25%") is a number, not a formula.
// Prefixing it turns the cell into text, so a spreadsheet stops summing the column.
const CSV_PLAIN_NEGATIVE_NUMBER = /^-\d+(?:[.,]\d+)?%?$/;

export function neutralizeCsvFormulaValue(value: string): string {
  const text = String(value ?? '');
  if (!text) return '';
  if (CSV_FORMULA_TRIGGER.test(text) && !CSV_PLAIN_NEGATIVE_NUMBER.test(text)) {
    return `'${text}`;
  }
  return text;
}

/**
 * fast-csv `transform` that neutralises every string field of a row.
 *
 * Pass it to `format({ headers, delimiter, transform: neutralizeCsvRow })`. Neutralising
 * the whole row rather than hand-picked columns means a field added later to an export is
 * protected by default — picking columns per export is how the raw exporters came to be
 * unprotected while others were not.
 *
 * Non-string values (numbers, booleans, null, dates) pass through untouched, and array
 * rows are handled too, so it is safe to attach to any formatter.
 */
export function neutralizeCsvRow<T>(row: T): T {
  if (Array.isArray(row)) {
    return row.map((value) =>
      typeof value === 'string' ? neutralizeCsvFormulaValue(value) : value,
    ) as unknown as T;
  }
  if (row && typeof row === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      out[key] = typeof value === 'string' ? neutralizeCsvFormulaValue(value) : value;
    }
    return out as unknown as T;
  }
  return row;
}

/**
 * Reverse of neutralizeCsvFormulaValue: strips the protective apostrophe an
 * export added in front of a formula-like value, so export -> import
 * round-trips cleanly. Only strips when the remainder is formula-like
 * (i.e. the apostrophe is ours, not user data).
 */
export function denormalizeCsvFormulaValue(value: string): string {
  const text = String(value ?? '');
  if (text.startsWith("'") && CSV_FORMULA_TRIGGER.test(text.slice(1))) {
    return text.slice(1);
  }
  return text;
}

/**
 * Row counterpart of denormalizeCsvFormulaValue, for the importers that parse their file
 * with fast-csv directly. Every exporter that carries `transform: neutralizeCsvRow` needs
 * it on its import side, otherwise re-importing an unmodified export stores the apostrophe.
 */
export function denormalizeCsvRow<T>(row: T): T {
  if (row && typeof row === 'object' && !Array.isArray(row)) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      out[key] = typeof value === 'string' ? denormalizeCsvFormulaValue(value) : value;
    }
    return out as unknown as T;
  }
  return row;
}

/**
 * Export options
 */
export interface CsvExportOptions {
  /** TypeORM EntityManager */
  manager: EntityManager;
  /** Tenant ID */
  tenantId: string;
  /** Export scope: 'template' returns only headers, 'data' returns all rows */
  scope?: 'template' | 'data';
  /** Selected fields to export (by csvColumn). If not provided, uses defaultExport fields */
  fields?: string[];
  /** Export preset name to use */
  preset?: string;
  /**
   * The screen language, as for every file of the shared layer: the separator, the days, the
   * decimal mark, yes or no and the headers a config translates (`headerLabels`) follow it.
   */
  language: CsvLanguage;
  /**
   * The zone the date-times (`zonedDateTime` fields) are written in, named in their header
   * (`detected_at (Europe/Paris)`): the exporting user's. UTC when not given.
   */
  timeZone?: string;
}

/**
 * Service for exporting entities to CSV format.
 *
 * Features:
 * - Declarative field configuration
 * - FK resolution (user emails, entity names)
 * - Array expansion to numbered columns
 * - UTF-8 BOM, separator, days, decimal mark and yes or no of the shared layer (`csv-sheet`)
 * - Template export (headers only)
 */
@Injectable()
export class CsvExportService {
  /** Default max items for array fields */
  private readonly DEFAULT_MAX_ITEMS = 4;

  constructor(private readonly resolver: CsvResolverService) {}

  /**
   * Export entities to CSV format.
   *
   * @param config - Entity CSV configuration
   * @param entities - Entities to export
   * @param opts - Export options
   * @returns Export result with filename, content, and metadata
   */
  async export(
    config: CsvEntityConfig,
    entities: any[],
    opts: CsvExportOptions,
  ): Promise<CsvExportResult> {
    const warnings: string[] = [];

    // Determine which fields to export
    const exportFields = this.selectExportFields(config, opts);

    // Build CSV headers from field definitions
    const columns = this.buildHeaders(config, exportFields, opts.language);
    // A date-time column names the zone of its cells after its header; the template names it too,
    // so a filled template is read in the zone its user typed.
    const timeZone = opts.timeZone ?? 'UTC';
    const zoned = new Set(exportFields.filter((f) => f.zonedDateTime).map((f) => f.csvColumn));
    const headerTexts = columns.map(({ column, header }) => (zoned.has(column) ? timeZoneHeader(header, timeZone) : header));
    const headerLine = writeCsvHeader(opts.language, headerTexts);

    // Template export: return headers only
    if (opts.scope === 'template') {
      return {
        filename: `${config.entityName}_template.csv`,
        content: headerLine,
        rowCount: 0,
        warnings: [],
      };
    }

    // Preload FK resolvers
    const resolverCache = await this.resolver.preloadResolvers(
      opts.tenantId,
      exportFields,
      opts.manager,
    );

    // Build reverse lookup maps for FK fields
    const reverseLookups = this.buildReverseLookups(exportFields, resolverCache);

    // Create export context
    const context: CsvExportContext = {
      tenantId: opts.tenantId,
      manager: opts.manager,
      resolverCache,
      language: opts.language,
      timeZone,
    };

    // Process relation handlers if any
    const relationData = new Map<string, Map<string, Record<string, string>>>();
    if (config.relationHandlers) {
      for (const handler of config.relationHandlers) {
        const handlerData = new Map<string, Record<string, string>>();
        for (const entity of entities) {
          const values = await handler.exportHandler(entity, context);
          handlerData.set(entity.id, values);
        }
        relationData.set(handler.name, handlerData);
      }
    }

    // Generate CSV content: the shared layer quotes, guards formulas and picks the separator.
    const rows = entities.map((entity) => {
      const row = this.buildRow(entity, exportFields, reverseLookups, relationData, context, warnings);
      return columns.map(({ column }) => row[column] ?? '');
    });

    return {
      filename: `${config.entityName}_export.csv`,
      content: headerLine + writeCsvRows({ language: opts.language, headers: headerTexts, rows }),
      rowCount: entities.length,
      warnings,
    };
  }

  /**
   * Get field metadata for frontend display.
   */
  getFieldInfo(config: CsvEntityConfig): CsvFieldDefinition[] {
    return config.fields.filter((f) => f.exportable !== false || f.importable !== false);
  }

  /**
   * Select fields to export based on options.
   */
  private selectExportFields(
    config: CsvEntityConfig,
    opts: CsvExportOptions,
  ): CsvFieldDefinition[] {
    // For template scope, use all importable fields (so users see what they can import)
    if (opts.scope === 'template') {
      return config.fields.filter((f) => f.importable !== false);
    }

    // Filter to exportable fields
    let fields = config.fields.filter((f) => f.exportable !== false);

    // Apply preset if specified
    if (opts.preset && config.exportPresets) {
      const preset = config.exportPresets.find((p) => p.name === opts.preset);
      if (preset) {
        const presetSet = new Set(preset.fields);
        fields = fields.filter((f) => presetSet.has(f.csvColumn));
      }
    }

    // Apply explicit field selection if specified
    if (opts.fields && opts.fields.length > 0) {
      const fieldSet = new Set(opts.fields);
      fields = fields.filter((f) => fieldSet.has(f.csvColumn));
    }

    // No preset and no explicit fields: return all exportable fields (truly full export)
    return fields;
  }

  /**
   * Build the columns of the file from field definitions, with their header in the file's
   * language when the config translates it. Expands array fields with numbered columns.
   */
  private buildHeaders(
    config: CsvEntityConfig,
    fields: CsvFieldDefinition[],
    language: CsvLanguage,
  ): Array<{ column: string; header: string }> {
    const columns: Array<{ column: string; header: string }> = [];
    const processedArrays = new Set<string>();

    for (const field of fields) {
      if (
        field.type === CsvFieldType.ARRAY &&
        field.arrayStrategy === ArrayStrategy.NUMBERED_COLUMNS
      ) {
        // Skip if we've already processed this array base
        const baseName = field.csvColumn.replace(/_\d+$/, '');
        if (processedArrays.has(baseName)) {
          continue;
        }
        processedArrays.add(baseName);

        // Generate numbered columns. Their headers stay technical: the import reads them by the
        // column name, and no translated alias is generated for a numbered column.
        const maxItems = field.maxItems ?? this.DEFAULT_MAX_ITEMS;
        for (let i = 1; i <= maxItems; i++) {
          const column = `${baseName}_${i}`;
          columns.push({ column, header: column });
        }
      } else if (!field.arrayIndex) {
        // Regular field (skip array index fields, they're generated above)
        columns.push({ column: field.csvColumn, header: this.headerOf(config, field, language) });
      }
    }

    return columns;
  }

  /** The header of a field in `language`, or its technical column when the config translates none. */
  private headerOf(config: CsvEntityConfig, field: CsvFieldDefinition, language: CsvLanguage): string {
    return config.headerLabels?.[field.csvColumn]?.[language] ?? field.csvColumn;
  }

  /**
   * Build reverse lookup maps for FK resolution.
   */
  private buildReverseLookups(
    fields: CsvFieldDefinition[],
    resolverCache: Map<string, Map<string, any>>,
  ): Map<string, Map<string, string>> {
    const lookups = new Map<string, Map<string, string>>();

    for (const field of fields) {
      if (
        (field.type === CsvFieldType.FK_BY_EMAIL ||
          field.type === CsvFieldType.FK_BY_NAME ||
          field.type === CsvFieldType.FK_BY_CODE) &&
        field.fkEntity
      ) {
        if (!lookups.has(field.fkEntity)) {
          lookups.set(
            field.fkEntity,
            this.resolver.buildReverseLookup(field.fkEntity, resolverCache),
          );
        }
      }
    }

    return lookups;
  }

  /**
   * Build a CSV row from an entity.
   */
  private buildRow(
    entity: any,
    fields: CsvFieldDefinition[],
    reverseLookups: Map<string, Map<string, string>>,
    relationData: Map<string, Map<string, Record<string, string>>>,
    context: CsvExportContext,
    warnings: string[],
  ): Record<string, string> {
    const row: Record<string, string> = {};
    const processedArrays = new Set<string>();

    for (const field of fields) {
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

        this.expandArrayToColumns(entity, field, row, reverseLookups, warnings);
        continue;
      }

      // Skip array index fields (handled above)
      if (field.arrayIndex) {
        continue;
      }

      // Get field value
      const value = this.getFieldValue(entity, field, reverseLookups, relationData, context);
      row[field.csvColumn] = this.neutralizeFormulaValue(value);
    }

    return row;
  }

  /**
   * Expand an array field to numbered columns.
   */
  private expandArrayToColumns(
    entity: any,
    field: CsvFieldDefinition,
    row: Record<string, string>,
    reverseLookups: Map<string, Map<string, string>>,
    warnings: string[],
  ): void {
    const baseName = field.csvColumn.replace(/_\d+$/, '');
    const maxItems = field.maxItems ?? this.DEFAULT_MAX_ITEMS;
    const arrayValue = entity[field.entityProperty];

    if (!Array.isArray(arrayValue)) {
      // Fill with empty values
      for (let i = 1; i <= maxItems; i++) {
        row[`${baseName}_${i}`] = '';
      }
      return;
    }

    // Check for truncation
    if (arrayValue.length > maxItems) {
      warnings.push(
        `Row ${entity.id}: ${field.entityProperty} has ${arrayValue.length} items, truncated to ${maxItems}`,
      );
    }

    // Fill columns
    for (let i = 1; i <= maxItems; i++) {
      const idx = i - 1;
      if (idx < arrayValue.length) {
        const itemValue = arrayValue[idx];

        // Resolve FK if needed
        if (field.fkEntity && reverseLookups.has(field.fkEntity)) {
          const lookup = reverseLookups.get(field.fkEntity)!;
          row[`${baseName}_${i}`] = this.neutralizeFormulaValue(lookup.get(itemValue) ?? '');
        } else {
          row[`${baseName}_${i}`] = this.neutralizeFormulaValue(String(itemValue ?? ''));
        }
      } else {
        row[`${baseName}_${i}`] = '';
      }
    }
  }

  /**
   * Get the value for a single field.
   */
  private getFieldValue(
    entity: any,
    field: CsvFieldDefinition,
    reverseLookups: Map<string, Map<string, string>>,
    relationData: Map<string, Map<string, Record<string, string>>>,
    context: CsvExportContext,
  ): string {
    // Computed fields, and fields that write their own cell (an incident's date-times)
    if (field.exportFn) {
      return field.exportFn(entity, context) ?? '';
    }

    // Get raw value from entity
    let rawValue = entity[field.entityProperty];

    // Handle nested paths (e.g., [0].type for ip_addresses[0].type)
    if (field.nestedPath && rawValue !== null && rawValue !== undefined) {
      rawValue = this.getNestedValue(rawValue, field.nestedPath);
    }

    // Handle null/undefined
    if (rawValue === null || rawValue === undefined) {
      return '';
    }

    // Handle FK resolution
    if (
      (field.type === CsvFieldType.FK_BY_EMAIL ||
        field.type === CsvFieldType.FK_BY_NAME ||
        field.type === CsvFieldType.FK_BY_CODE) &&
      field.fkEntity
    ) {
      const lookup = reverseLookups.get(field.fkEntity);
      if (lookup) {
        return lookup.get(String(rawValue)) ?? '';
      }
    }

    // Handle arrays (comma-separated)
    if (field.type === CsvFieldType.ARRAY && field.arrayStrategy !== ArrayStrategy.NUMBERED_COLUMNS) {
      if (Array.isArray(rawValue)) {
        return rawValue.join(', ');
      }
    }

    // Handle JSON
    if (field.type === CsvFieldType.JSON) {
      return JSON.stringify(rawValue);
    }

    // Handle dates: the day, written the language's way
    if (field.type === CsvFieldType.DATE) {
      const day = rawValue instanceof Date ? rawValue.toISOString().split('T')[0] : String(rawValue).split('T')[0];
      try {
        return formatCsvDate(day, context.language);
      } catch {
        return day;
      }
    }

    // Handle numbers: the language's decimal mark, no thousands separator
    if (field.type === CsvFieldType.NUMBER) {
      const text = String(rawValue);
      return csvProfile(context.language).decimal === ',' && /^-?\d+\.\d+$/.test(text) ? text.replace('.', ',') : text;
    }

    // Handle booleans: yes or no in the language
    if (field.type === CsvFieldType.BOOLEAN) {
      return formatCsvBoolean(!!rawValue, context.language);
    }

    // Default: string conversion
    return String(rawValue);
  }

  private neutralizeFormulaValue(value: string): string {
    return neutralizeCsvFormulaValue(value);
  }

  /**
   * Get a nested value from an object using dot notation.
   * Supports array index notation like [0].property
   */
  private getNestedValue(obj: any, path: string): any {
    // Parse path segments, handling array indices like [0]
    const segments: (string | number)[] = [];
    let i = 0;
    while (i < path.length) {
      if (path[i] === '[') {
        // Array index
        const endBracket = path.indexOf(']', i);
        if (endBracket === -1) break;
        const index = parseInt(path.substring(i + 1, endBracket), 10);
        segments.push(index);
        i = endBracket + 1;
        if (path[i] === '.') i++; // Skip dot after bracket
      } else {
        // Property name
        let end = path.indexOf('.', i);
        const bracketStart = path.indexOf('[', i);
        if (end === -1) end = path.length;
        if (bracketStart !== -1 && bracketStart < end) end = bracketStart;
        const prop = path.substring(i, end);
        if (prop) segments.push(prop);
        i = end;
        if (path[i] === '.') i++; // Skip dot
      }
    }

    let current = obj;
    for (const segment of segments) {
      if (current === null || current === undefined) {
        return null;
      }
      current = current[segment];
    }

    return current;
  }
}
