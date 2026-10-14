import { oneOffListLink, type ReportListLink } from '../../pages/reports/reportListLink';
import { keepValues } from '../../pages/reports/reportAggregates';
import { STATUS_SCOPE_PARAM } from '../../utils/statusScopeParams';
import type { UsageOwner, UsageType } from './RecordUsagesSection';

/** The list a group of the "Used by" section opens: its href, and how to save filters too long for a URL. */
export type UsageListLink = ReportListLink;

/** A text filter keeping the rows whose column equals `value`, as the lists' text filters write it. */
function textEquals(value: string) {
  return { filterType: 'text', type: 'equals', filter: value };
}

function listHref(path: string, filters: Record<string, unknown>, extra: Record<string, string>): string {
  const params = new URLSearchParams({ filters: JSON.stringify(filters) });
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  return `${path}?${params.toString()}`;
}

/**
 * The list of a group's type filtered on the supplier, showing every object the group counts, or null
 * when that list cannot filter on it. The lists filter on the supplier's name, which is unique per
 * tenant, in the column and the filter format each list writes itself:
 * - budget lines: the budget list of both natures, every status, as a one-off view (`oneOffListLink`,
 *   the set filter of the Supplier column), as the report rows open it;
 * - contracts: the Supplier column's text filter, every status;
 * - applications: the Supplier column's text filter (the column shows itself), all applications, every
 *   lifecycle state ticked: without a lifecycle filter the list leaves the retired ones out. Null while
 *   the states are unknown (`applicationLifecycles`, the IT operations settings still loading).
 *
 * No list filters on a contact, nor the asset list on a support vendor: those groups get no link.
 */
export function usageListLink(
  owner: UsageOwner,
  type: UsageType,
  ownerName: string | null | undefined,
  context: { applicationLifecycles?: readonly string[] } = {},
): UsageListLink | null {
  if (owner !== 'suppliers' || !ownerName) return null;
  switch (type) {
    case 'budget_lines':
      return oneOffListLink('all', { supplier_name: keepValues([ownerName]) });
    case 'contracts':
      return { href: listHref('/ops/contracts', { supplier_name: textEquals(ownerName) }, { [STATUS_SCOPE_PARAM]: 'all' }) };
    case 'applications': {
      const lifecycles = context.applicationLifecycles ?? [];
      if (lifecycles.length === 0) return null;
      const filters = { supplier_name: textEquals(ownerName), lifecycle: keepValues([...lifecycles]) };
      return { href: listHref('/it/applications', filters, { appScope: 'all' }) };
    }
    default:
      return null;
  }
}
