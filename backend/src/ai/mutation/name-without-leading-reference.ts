/**
 * A record's name without a reference it repeats at its start ("CON-1 - DB link" for CON-1):
 * the label prepends the reference for the screens, and prepending it to a name that already
 * carries it would show it twice ("CON-1 - CON-1 - DB link").
 */
export function nameWithoutLeadingReference(reference: string | null, name: string | null): string | null {
  if (!name) return null;
  if (!reference) return name;
  const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rest = name.replace(new RegExp(`^${escaped}(?:\\s*[-–—·:|]\\s*|\\s+)`, 'i'), '').trim();
  if (rest && rest !== name) return rest;
  // A name that is only the reference leaves the title to the reference the card already shows.
  return name.toLowerCase() === reference.toLowerCase() ? null : name;
}
