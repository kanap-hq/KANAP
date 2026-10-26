import { BadRequestException } from '@nestjs/common';

/** The file formats of an export that offers both. */
export type ExportFileFormat = 'csv' | 'xlsx';

/** The `format` query of an export: empty is CSV; anything other than `csv` or `xlsx` answers 400. */
export function parseExportFormat(raw: unknown): ExportFileFormat {
  if (raw === undefined || raw === null || raw === '') return 'csv';
  if (raw === 'csv' || raw === 'xlsx') return raw;
  throw new BadRequestException('format must be csv or xlsx.');
}
