/**
 * The fields of a preview in the order its entity declares them, then the others (an analytics
 * dimension) by name. The stored mutation is jsonb, which keeps no key order: without this, a card
 * read back after approval lists its fields in another order than while it waited.
 */
export function previewFieldOrder(fields: Record<string, unknown>, declared: Record<string, unknown>): string[] {
  const names = Object.keys(fields);
  const present = new Set(names);
  const known = Object.keys(declared).filter((name) => present.has(name));
  const declaredNames = new Set(known);
  const others = names.filter((name) => !declaredNames.has(name)).sort();
  return [...known, ...others];
}
