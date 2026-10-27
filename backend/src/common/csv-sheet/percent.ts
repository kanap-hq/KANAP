import { csvProfile } from './language';
import { CsvLanguage } from './types';

/**
 * A share written in a CSV file: a fraction (`0.125`) as points with two decimals, the language's
 * decimal mark and a percent sign (`12.50%` in English, `12,50%` in French). A spreadsheet opened
 * in that language reads it back as the number 0.125 shown as a percentage; the xlsx writer stores
 * the same fraction in a `percent` cell.
 */
export function formatCsvPercent(fraction: number, language: CsvLanguage): string {
  if (typeof fraction !== 'number' || !Number.isFinite(fraction)) throw new Error(`Invalid percent '${String(fraction)}'.`);
  // Rounded on the hundredth of a point first, so 0.0004999… is not written -0.00 or 0.05 by a float.
  const points = Math.round(fraction * 10_000) / 100;
  const text = (Object.is(points, -0) ? 0 : points).toFixed(2);
  return `${csvProfile(language).decimal === ',' ? text.replace('.', ',') : text}%`;
}
