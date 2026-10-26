/** Same bounds as `parseCompanyYear` on the server (1900 to 2999). */
const COMPANY_YEAR = /^(?:19\d{2}|2\d{3})$/;

/**
 * A year the companies list may request. Null while the field is empty or still
 * a partial value, so the page keeps the previous result.
 */
export function companyListYear(value: string): number | null {
  const text = value.trim();
  if (!COMPANY_YEAR.test(text)) return null;
  return Number(text);
}
