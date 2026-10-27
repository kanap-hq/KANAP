import { BadRequestException } from '@nestjs/common';

/** The file formats of an export that offers both. */
export type ExportFileFormat = 'csv' | 'xlsx';

/**
 * The `format` query of an export, trimmed and in any case (`XLSX` is xlsx), as the weekly report
 * reads it: empty is CSV; anything other than `csv` or `xlsx` answers 400.
 */
export function parseExportFormat(raw: unknown): ExportFileFormat {
  if (raw === undefined || raw === null) return 'csv';
  if (typeof raw !== 'string') throw new BadRequestException('format must be csv or xlsx.');
  const value = raw.trim().toLowerCase();
  if (value === '') return 'csv';
  if (value === 'csv' || value === 'xlsx') return value;
  throw new BadRequestException('format must be csv or xlsx.');
}
