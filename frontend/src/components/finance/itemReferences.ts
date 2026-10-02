import type { SupplierOption } from '../fields/SupplierSelect';
import type { CompanyOption } from '../fields/CompanySelect';
import type { AccountOption } from '../fields/AccountSelect';
import type { UserOption } from '../fields/userLookup';
import type { ItemAnalyticsValue } from '../../services/analytics';
import { formatUserName } from '../../utils/userDisplay';

/**
 * The labels of an OPEX or CAPEX line's references, as the detail returns them
 * (`references`, backend `spend/item-workspace.util.ts`): the workspace pickers
 * show the chosen values from these, without loading any list.
 */
export type ItemReferences = {
  supplier: SupplierOption | null;
  paying_company: CompanyOption | null;
  account: AccountOption | null;
  owner_it: UserOption | null;
  owner_business: UserOption | null;
};

/** The detail's references, when they still describe the ids the form holds (a pick not saved yet has none). */
export function itemReferences(data: unknown): Partial<ItemReferences> {
  const refs = (data as { references?: Partial<ItemReferences> } | null | undefined)?.references;
  return refs && typeof refs === 'object' ? refs : {};
}

/** A reference's label only when it names the id shown (`id`): otherwise the picker reads it itself. */
export function matching<T extends { id: string }>(option: T | null | undefined, id: string | null | undefined): T | null {
  return option && id && option.id === id ? option : null;
}

/** The value picked on each dimension, as `{ id, name }` per dimension id (the detail's analytics values). */
export function analyticsValueOptions(data: unknown): Record<string, { id: string; name: string }> {
  const list = (data as { analytics_values?: ItemAnalyticsValue[] } | null | undefined)?.analytics_values;
  if (!Array.isArray(list)) return {};
  return Object.fromEntries(list.filter((v) => v?.axis_id && v.category_id).map((v) => [v.axis_id, { id: v.category_id, name: v.category_name }]));
}

/** An owner's display name from the references, for the metadata bar (no `/users/:id` read). */
export function ownerName(option: UserOption | null | undefined, id: string | null | undefined): string | null {
  return formatUserName(matching(option, id)) ?? null;
}
