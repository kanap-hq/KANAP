import type { QueryClient } from '@tanstack/react-query';
import type { CheckboxSetFilterContext, CheckboxSetFilterGroup, CheckboxSetFilterOption } from '../CheckboxSetFilter';
import { fetchCostCenterTree } from '../../hooks/useCostCenterTree';
import { costCenterLabel, type CostCenterNode } from '../../services/costCenters';

type GetValues = (ctx: CheckboxSetFilterContext) => Promise<CheckboxSetFilterOption[]>;

/**
 * The values of a list's cost center column (`code · name` labels, the ones the lines hold) laid out
 * as the tree: in tree order, each under its groups, so the filter can tick a whole group. Budget
 * lines only carry cost centers, never groups, so a group is a heading over the values below it, not
 * a value. Labels the tree does not hold, then the blank value, follow as they came.
 */
export function costCenterFilterOptions(options: CheckboxSetFilterOption[], nodes: CostCenterNode[]): CheckboxSetFilterOption[] {
  if (nodes.length === 0) return options;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const byLabel = new Map(nodes.map((node) => [costCenterLabel(node), node]));
  const used = new Map<string, CheckboxSetFilterOption>();
  const unknown: CheckboxSetFilterOption[] = [];
  const blank: CheckboxSetFilterOption[] = [];
  for (const option of options) {
    if (option.value == null) {
      blank.push(option);
      continue;
    }
    const node = byLabel.get(String(option.value));
    if (node) used.set(node.id, option);
    else unknown.push(option);
  }
  const groupsOf = (node: CostCenterNode): CheckboxSetFilterGroup[] => {
    const groups: CheckboxSetFilterGroup[] = [];
    const seen = new Set<string>([node.id]);
    let parent = node.parent_id ? byId.get(node.parent_id) : undefined;
    // The server refuses cycles; the guard keeps a bad payload from looping.
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      groups.unshift({ key: parent.id, label: costCenterLabel(parent) });
      parent = parent.parent_id ? byId.get(parent.parent_id) : undefined;
    }
    return groups;
  };
  const inTree: CheckboxSetFilterOption[] = [];
  for (const node of nodes) {
    const option = used.get(node.id);
    if (option) inTree.push({ ...option, groups: groupsOf(node) });
  }
  return [...inTree, ...unknown, ...blank];
}

/**
 * Wraps a cost center column's `getValues`: once the values are in, and when a line holds a cost
 * center, the tree is read (cached for every cost center picker) and the values laid out under their
 * groups. Without a cost center in use, or when the tree fails to load, the values stay a flat list.
 */
export function withCostCenterGroups(getValues: GetValues, queryClient: QueryClient): GetValues {
  return async (ctx) => {
    const options = await getValues(ctx);
    if (!options.some((option) => option.value != null)) return options;
    let nodes: CostCenterNode[];
    try {
      nodes = await fetchCostCenterTree(queryClient);
    } catch {
      return options;
    }
    return costCenterFilterOptions(options, nodes);
  };
}
