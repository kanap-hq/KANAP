/**
 * The stream a request, a project or a task already carries when its picker does not offer it: an
 * inactive stream, or a stream of another category than the record's, kept from before the rule that a
 * stream belongs to its category (lot I7a of 26.12.1). The record keeps it and shows it until its
 * category or its stream changes; its own category, when it is another one, follows in parentheses.
 */

type CatalogStream = { id: string; name: string; category_id?: string | null };
type CatalogCategory = { id: string; name: string };

/** The full lists of the portfolio classification (`/portfolio/classification/all`), inactive values included. */
export type ClassificationCatalog = {
  sources?: CatalogCategory[];
  streams?: CatalogStream[];
  categories?: CatalogCategory[];
} | null | undefined;

/**
 * The values a picker offers (the active ones), plus the one the record carries when it is not among
 * them (an inactive source or category): the record shows it by its name and keeps it until it changes;
 * the other records are not offered it.
 */
export function withCarriedValue<T extends { id: string; name: string }>(
  offered: T[],
  currentId: string | null | undefined,
  all: CatalogCategory[] | undefined,
): Array<{ id: string; name: string }> {
  if (!currentId || offered.some((item) => item.id === currentId)) return offered;
  // A value the person cannot name stays blank: never its raw id.
  return [...offered, { id: currentId, name: all?.find((item) => item.id === currentId)?.name ?? '' }];
}

/** The name of a stream, with its own category in parentheses when the record's category is another one. */
export function carriedStreamLabel(
  streamId: string | null | undefined,
  recordCategoryId: string | null | undefined,
  catalog: ClassificationCatalog,
  knownName?: string | null,
): string | null {
  if (!streamId) return null;
  const stream = catalog?.streams?.find((item) => item.id === streamId);
  const name = stream?.name ?? knownName ?? null;
  if (!name || !stream?.category_id || stream.category_id === (recordCategoryId || null)) return name;
  const category = catalog?.categories?.find((item) => item.id === stream.category_id)?.name;
  return category ? `${name} (${category})` : name;
}

/** The streams a picker offers, plus the one the record carries when it is not among them. */
export function withCarriedStream<T extends { id: string; name: string }>(
  offered: T[],
  streamId: string | null | undefined,
  recordCategoryId: string | null | undefined,
  catalog: ClassificationCatalog,
): Array<{ id: string; name: string }> {
  if (!streamId || offered.some((item) => item.id === streamId)) return offered;
  // A stream the person cannot name stays blank: never its raw id.
  return [...offered, { id: streamId, name: carriedStreamLabel(streamId, recordCategoryId, catalog) ?? '' }];
}
