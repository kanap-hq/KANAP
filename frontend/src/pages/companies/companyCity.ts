/**
 * City stored for a company that has none yet (the starting company). The column cannot be blank,
 * and company creation refuses an empty city, so this word is kept. It is not a city name: the
 * company record and the companies list show an empty city instead.
 * Same word as `STARTING_COMPANY_CITY` in the tenant baseline.
 */
export const UNSET_COMPANY_CITY = 'Unknown';

/** The city to show. The starting-company placeholder is blank; any other value is kept as stored. */
export function displayedCompanyCity(city: string | null | undefined): string {
  if (city == null) return '';
  return city.trim() === UNSET_COMPANY_CITY ? '' : city;
}
