import { addMonthsYmd } from '../../contracts/contract-terms';

/**
 * The day the planning timeline opens on: `todayYmd` minus `monthsBack` months.
 * The day is brought back to that month's last day. The result is a calendar
 * day, `YYYY-MM-DD`, with no time.
 */
export function timelineStart(todayYmd: string, monthsBack: number): string {
  return addMonthsYmd(todayYmd, -monthsBack);
}
