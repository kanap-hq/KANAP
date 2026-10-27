import { formatCentsFixed, toCents } from '../amount';

/**
 * An amount of a report as the text of its `amount` cell: to the cent, half away from zero, rounded on
 * the decimal text of the number (`1.005` is `1.01`, `-1.125` is `-1.13`), never through a float.
 */
export function reportAmount(value: number): string {
  return formatCentsFixed(toCents(value));
}
