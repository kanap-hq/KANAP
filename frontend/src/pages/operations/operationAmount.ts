import { formatAmount } from '../../i18n/formatters';

/**
 * Amounts on the column operation grids: whole values as the rest of the app
 * shows them (`18 750`), two decimals otherwise (`1 204.80`), since a copy
 * without a percentage keeps cents.
 */
export function formatOperationAmount(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '';
  const cents = Math.round(n * 100);
  if (cents % 100 === 0) return formatAmount(cents / 100);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${formatAmount(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, '0')}`;
}
