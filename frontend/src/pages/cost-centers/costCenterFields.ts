import type { TFunction } from 'i18next';
import type { CostCenterKind } from '../../services/costCenters';

export const COST_CENTER_KINDS: CostCenterKind[] = ['group', 'cost_center'];

/** Fields a refusal can be attached to, so the error shows under the field that caused it. */
export type CostCenterField =
  | 'code'
  | 'name'
  | 'kind'
  | 'parent_id'
  | 'company_id'
  | 'owner_user_id'
  | 'description'
  | 'disabled_at';

/** "Used by 3 OPEX lines and 1 CAPEX line.", or null when no line uses the node. */
export function costCenterUsageLine(t: TFunction, opexCount: number, capexCount: number): string | null {
  const opex = opexCount > 0 ? t('costCenters.usage.opex', { count: opexCount }) : null;
  const capex = capexCount > 0 ? t('costCenters.usage.capex', { count: capexCount }) : null;
  if (opex && capex) return t('costCenters.usage.both', { opex, capex });
  if (opex || capex) return t('costCenters.usage.one', { lines: opex ?? capex });
  return null;
}

const REFUSAL_FIELDS: ReadonlySet<string> = new Set<CostCenterField>([
  'code', 'name', 'kind', 'parent_id', 'company_id', 'owner_user_id', 'description', 'disabled_at',
]);

/**
 * The field a server refusal names (`{ message, field }` in the 400 body), mapped to the form's fields,
 * or null when the body names none. A lifecycle refusal (`status`) belongs under the date.
 */
export function refusalField(error: unknown): CostCenterField | null {
  const raw = (error as { response?: { data?: { field?: unknown } } } | null)?.response?.data?.field;
  const field = raw === 'status' ? 'disabled_at' : raw;
  return typeof field === 'string' && REFUSAL_FIELDS.has(field) ? (field as CostCenterField) : null;
}

/** The line that explains a disabled Delete, or null when the node can be deleted. */
export function costCenterDeleteBlock(
  t: TFunction,
  usage: string | null,
  childCount: number,
): string | null {
  if (usage) return t('costCenters.deleteBlocked.used', { usage });
  if (childCount > 0) return t('costCenters.deleteBlocked.children', { count: childCount });
  return null;
}
