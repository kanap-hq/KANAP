import type { TFunction } from 'i18next';

/** ISO 8601 week number and week-year of a calendar date (its local year, month and day). */
export function getIsoWeek(date: Date): { week: number; year: number } {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const year = utc.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const week = Math.ceil(((utc.getTime() - yearStart) / 86400000 + 1) / 7);
  return { week, year };
}

/** ISO week of a "YYYY-MM-DD" date string. */
export function getIsoWeekOfYmd(ymd: string): { week: number; year: number } {
  const [year, month, day] = ymd.split('-').map(Number);
  if (!year || !month || !day) return { week: 0, year: 0 };
  return getIsoWeek(new Date(year, month - 1, day));
}

/** Short week label in the reader's language: "W05" in English, "S05" in French and Spanish, "KW05" in German. */
export function formatWeekLabel(t: TFunction, date: Date): string {
  const { week } = getIsoWeek(date);
  return t('portfolio:planning.roadmap.occupation.week', { week: String(week).padStart(2, '0') });
}

/** Quarter label in the reader's language: "Q2 2026" in English, "T2 2026" in French. */
export function formatQuarterLabel(t: TFunction, date: Date): string {
  return t('portfolio:planning.roadmap.occupation.quarterYear', {
    quarter: Math.floor(date.getMonth() / 3) + 1,
    year: date.getFullYear(),
  });
}
