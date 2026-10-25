/**
 * First and last name, with null and blank parts left out.
 * `fallback` (default '') is returned when nothing remains, so a user with
 * no name stays the caller's word ("Someone", "Unknown", an email) instead
 * of the string a template literal builds from two nulls.
 */
export function displayName(
  row: { first_name?: string | null; last_name?: string | null } | null | undefined,
  fallback = '',
): string {
  const name = [row?.first_name, row?.last_name]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' ');
  return name || fallback;
}
