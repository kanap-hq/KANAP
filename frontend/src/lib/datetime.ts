/** Today's calendar day in the local time zone, as YYYY-MM-DD. */
export function localTodayYmd(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function isoToLocalDateTimeInput(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const timezoneOffsetMs = date.getTimezoneOffset() * 60000;
  const local = new Date(date.getTime() - timezoneOffsetMs);
  return local.toISOString().slice(0, 16);
}

export function localDateTimeInputToIso(value?: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function isoToLocalDateInput(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function localDateInputToEndOfDayIso(value?: string | null): string | null {
  if (!value) return null;
  const [yearStr, monthStr, dayStr] = value.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!year || !month || !day) return null;
  const local = new Date(year, month - 1, day, 23, 59, 0, 0);
  if (Number.isNaN(local.getTime())) return null;
  return local.toISOString();
}
