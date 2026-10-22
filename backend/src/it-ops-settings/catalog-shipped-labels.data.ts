/**
 * The catalog values KANAP ships, by list and code: the English label stored for a tenant
 * (`source`) and the label the app shows in each language while the tenant keeps it. The text
 * lives in `shipped-catalog-labels.json`. The frontend holds the same text for display
 * (`frontend/src/utils/itOpsCatalogDefaults.ts` and the `it:catalogDefaults`, `common:statuses`,
 * `common:taskTypes` and `classification-catalog` locale keys);
 * `frontend/src/utils/catalogShippedLabels.sync.test.ts` reads the JSON file and fails when the two differ.
 * A value may also list `former` labels a tenant still stores after a rename. Those are recognized
 * the same way while the stored label equals the former source. They are not part of the defaults.
 *
 * Imports use it so that a value typed as the user sees it ("Serveur physique") resolves to its code.
 */
// The JSON file has its own name: under ts-node, Node resolves `./x` to `x.json` before `x.ts`.
import * as shipped from './shipped-catalog-labels.json';

export type ShippedLabelText = { source: string; en: string; fr: string; de: string; es: string };
/** A shipped value. `former` holds labels a tenant may still store after a rename; they are not defaults. */
export type ShippedLabels = ShippedLabelText & { former?: readonly ShippedLabelText[] };

export const SHIPPED_CATALOG_LABELS: Record<string, Record<string, ShippedLabels>> = shipped.catalog;

/**
 * The task types KANAP ships, by code (`DEFAULT_TASK_TYPES`): the English name stored for a tenant
 * and the name the app shows in each language while the tenant keeps it (`common:taskTypes`).
 */
export const SHIPPED_TASK_TYPE_LABELS: Record<string, ShippedLabels> = shipped.taskTypes;
