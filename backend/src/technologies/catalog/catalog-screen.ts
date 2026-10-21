import type { CatalogProduct } from './technology-catalog.service';

/** Where the dates of one KANAP-maintained version were read, while the stored dates still match. */
export type CatalogDateSource = {
  source_url: string;
  checked_on: string;
  editor: string;
  no_planned_end: boolean;
};

type ScreenVersion = {
  catalog_key: string | null;
  standard_support_end: string | null;
  extended_support_end: string | null;
};

export type CatalogScreenRecord = {
  catalog_key?: string | null;
  versions: ScreenVersion[];
};

/** A product KANAP maintains carries `source_updated` (null when the vendor page states none). */
function maintainedByKanap(product: CatalogProduct): boolean {
  return Object.prototype.hasOwnProperty.call(product, 'source_updated');
}

/** `YYYY-MM-DD` or null. Null equals null: a date the catalog leaves empty still matches. */
function sameDay(stored: string | null, catalog: string | null | undefined): boolean {
  return (stored ?? null) === (catalog ?? null);
}

/**
 * The source of a version's dates. Empty unless the version comes from this product
 * (`<product>:<version key>`), the product is one KANAP maintains, and both stored end dates
 * still equal the shipped file.
 */
function dateSource(product: CatalogProduct, version: ScreenVersion): CatalogDateSource | null {
  if (!maintainedByKanap(product) || !version.catalog_key) return null;
  const prefix = `${product.key}:`;
  if (!version.catalog_key.startsWith(prefix)) return null;
  const shipped = product.versions.find((item) => item.key === version.catalog_key!.slice(prefix.length));
  const sourceUrl = shipped?.source_url?.trim();
  const checkedOn = shipped?.checked_on?.trim();
  if (!shipped || !sourceUrl || !checkedOn) return null;
  if (!sameDay(version.standard_support_end, shipped.standard_support_end)) return null;
  if (!sameDay(version.extended_support_end, shipped.extended_support_end)) return null;
  return {
    source_url: sourceUrl,
    checked_on: checkedOn,
    editor: product.editor,
    no_planned_end: shipped.no_planned_end === true,
  };
}

/** `GET /technologies/:id`: the service record, with the catalog fields the screen reads. */
export type CatalogScreen<T extends CatalogScreenRecord> = Omit<T, 'versions'> & {
  catalog_security_tracker: string | null;
  versions: Array<T['versions'][number] & { catalog_source: CatalogDateSource | null }>;
};

/**
 * The catalog fields of `GET /technologies/:id`. `product` is the shipped entry of the
 * technology's catalog key. Without that key, or when the file has no such entry, both fields
 * stay empty, including on a version that names a catalog key of its own.
 */
export function attachCatalogScreen<T extends CatalogScreenRecord>(
  record: T,
  product: CatalogProduct | undefined,
): CatalogScreen<T> {
  const known = record.catalog_key && product && product.key === record.catalog_key ? product : undefined;
  return {
    ...record,
    catalog_security_tracker: known?.security_tracker?.trim() || null,
    versions: record.versions.map((version) => ({
      ...version,
      catalog_source: known ? dateSource(known, version) : null,
    })),
  };
}
