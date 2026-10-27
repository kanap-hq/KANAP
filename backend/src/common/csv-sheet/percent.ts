import { formatCentsFixed } from '../amount';
import { parseDecimalLiteral, rescale } from '../decimal';
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
  // Rounded on the hundredth of a point, half away from zero, on the decimal text of the fraction
  // (`0.01005` is `1.01%`), never through a float; a value that rounds to zero is `0.00`.
  const { mantissa, scale } = parseDecimalLiteral(fraction);
  const text = formatCentsFixed(rescale(mantissa, scale - 2, 2));
  return `${csvProfile(language).decimal === ',' ? text.replace('.', ',') : text}%`;
}
