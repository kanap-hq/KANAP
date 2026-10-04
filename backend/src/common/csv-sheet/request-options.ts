import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { DecimalMark } from './amount';
import { csvLanguage } from './language';
import { CsvDateOrder, CsvLanguage } from './types';

/**
 * The reading options a CSV route takes from its query string. The budget
 * file route set them first (C2); every route that reads a file shares them.
 */

/**
 * The language the file is read and written in. The screen sends it. Without
 * it, the user's stored locale, then English.
 */
export async function languageOf(
  manager: EntityManager,
  tenantId: string,
  userId: string | null,
  requested: unknown,
): Promise<CsvLanguage> {
  if (requested != null && requested !== '') {
    if (requested !== 'en' && requested !== 'fr' && requested !== 'de' && requested !== 'es') {
      throw new BadRequestException('language must be en, fr, de or es.');
    }
    return requested;
  }
  if (!userId) return 'en';
  const rows: Array<{ locale: string | null }> = await manager.query(
    `SELECT locale FROM users WHERE tenant_id = $1 AND id = $2`,
    [tenantId, userId],
  );
  return csvLanguage(rows[0]?.locale);
}

/** The date order switch, used only when the file itself does not show one. */
export function parseDateOrder(raw: unknown): CsvDateOrder | undefined {
  if (raw == null || raw === '') return undefined;
  if (raw === 'day-first' || raw === 'month-first') return raw;
  throw new BadRequestException('dateOrder must be day-first or month-first.');
}

/** The decimal mark switch, used only when no amount cell settles it. */
export function parseDecimalMark(raw: unknown): DecimalMark | undefined {
  if (raw == null || raw === '') return undefined;
  if (raw === 'comma') return ',';
  if (raw === 'dot') return '.';
  throw new BadRequestException('decimalMark must be comma or dot.');
}
