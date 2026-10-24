import api from '../../../api';
import type {
  AssetRelationRow,
  BudgetLineRow,
  ContractRow,
  IncidentLinkRow,
  ProjectRow,
} from '../../../components/workspace/relations';

/** The four directions of a relation between assets, in the order of the Dependencies tab. */
export const ASSET_DIRECTIONS = ['contains', 'contained_by', 'depends_on', 'depended_on_by'] as const;
export type AssetDirection = (typeof ASSET_DIRECTIONS)[number];

export type AssetTaskRow = { id: string; item_number: number | null; title: string; status: string | null; assignee_name: string | null; due_date: string | null };

/** `GET /assets/:id/relations-tab`: the data of the Dependencies and Relations tabs and of their badges. */
export type AssetRelationsData = {
  year: number;
  budget_column: { key: string; label: string };
  assets: Record<AssetDirection, AssetRelationRow[]>;
  budget_lines: BudgetLineRow[] | null;
  /** The linked lines `budget_lines` leaves out, counted: outside the caller's data access, or all without the budget right. */
  budget_lines_hidden?: number;
  contracts: ContractRow[] | null;
  projects: ProjectRow[] | null;
  tasks: AssetTaskRow[] | null;
  incidents: IncidentLinkRow[] | null;
  counts: {
    /** Relations between assets: feeds the Dependencies badge. */
    assets: number;
    /** The Relations badge: every other count, each section only when the caller can read it. */
    total: number;
  } & Record<string, number>;
};

/**
 * The Relations badge: `counts.total` (the rows the tab lists) plus the budget lines the tab counts
 * without listing them (`budget_lines_hidden`). Undefined until the read is in.
 */
export function assetRelationsBadge(data: AssetRelationsData | undefined): number | undefined {
  return data ? (data.counts?.total ?? 0) + (data.budget_lines_hidden ?? 0) : undefined;
}

/** The one query key of the read, shared by both tabs and the page (tab badges). */
export const assetRelationsKey = (id: string) => ['asset-relations-tab', id] as const;

export async function fetchAssetRelationsTab(assetId: string): Promise<AssetRelationsData> {
  return (await api.get<AssetRelationsData>(`/assets/${assetId}/relations-tab`)).data;
}
