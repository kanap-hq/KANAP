import type { TFunction } from 'i18next';

/**
 * Types and display helpers of the data-access administration screens (spec §7.1 to §7.5).
 * The routes return these shapes (run 6A report): the dialog, the "Access" tabs, the
 * administration page and the users list column all read them here.
 */

export type DataAccessLevel = 'read' | 'edit';
export type DataAccessNodeType = 'all' | 'company' | 'cost_center';

export type AccessNode = {
  type: DataAccessNodeType;
  id: string | null;
  name: string | null;
  access: DataAccessLevel;
  /** Cost center and group nodes: their code. */
  code?: string | null;
  /** Cost center nodes only. */
  kind?: 'group' | 'cost_center' | null;
};

/** A node as the write routes take it. */
export type AccessNodeInput = { type: DataAccessNodeType; id: string | null; access: DataAccessLevel };

export type PersonAccess = {
  mode: 'all' | 'limited';
  nodes: AccessNode[];
  updated_at: string | null;
  updated_by_name: string | null;
  is_administrator: boolean;
  available: boolean;
  budget_owner_centers: Array<{ id: string; code: string; name: string }>;
};

export type DataAccessPreview = { lines: number; editable_lines: number; contracts: number };

export type AccessVia = {
  type: DataAccessNodeType;
  id?: string;
  code?: string | null;
  name: string | null;
};

export type CompanyAccessView = {
  full: Array<{ person: { id: string; name: string }; via: AccessVia; access: DataAccessLevel }>;
  partial: Array<{ person: { id: string; name: string }; via: AccessVia; access: DataAccessLevel }>;
};

export type CostCenterAccessView = {
  direct: Array<{ person: { id: string; name: string }; access: DataAccessLevel }>;
  inherited: Array<{ person: { id: string; name: string }; via: AccessVia; access: DataAccessLevel }>;
};

export type DataAccessOverview = {
  available: boolean;
  missing: string[];
  persons: Array<{
    id: string;
    name: string;
    roles: string[];
    nodes: AccessNode[];
    updated_at: string | null;
    updated_by_name: string | null;
  }>;
  counts: { limited_persons: number; lines_without_company: number };
};

/** The body of `PUT /users/:id/data-access` and of the preview route. */
export function accessBody(mode: 'all' | 'limited', nodes: readonly AccessNode[]): {
  mode: 'all' | 'limited';
  nodes: AccessNodeInput[];
} {
  return {
    mode,
    nodes: mode === 'all'
      ? []
      : nodes.map((node) => ({ type: node.type, id: node.id, access: node.access })),
  };
}

const TYPE_RANK: Record<DataAccessNodeType, number> = { all: 0, company: 1, cost_center: 2 };

function nodeSortKey(node: AccessNode): string {
  if (node.type === 'company') return (node.name ?? '').toLocaleLowerCase();
  return (node.code ?? node.name ?? '').toLocaleLowerCase();
}

/** The order the routes return: everything, companies by name, cost centers by code. */
export function sortAccessNodes(nodes: readonly AccessNode[]): AccessNode[] {
  return [...nodes].sort((a, b) => {
    const type = TYPE_RANK[a.type] - TYPE_RANK[b.type];
    if (type !== 0) return type;
    const byKey = nodeSortKey(a).localeCompare(nodeSortKey(b));
    if (byKey !== 0) return byKey;
    return String(a.id ?? '').localeCompare(String(b.id ?? ''));
  });
}

/** "Everything", the label of an `all` node. */
export function everythingLabel(t: TFunction): string {
  return t('admin:dataAccess.types.everything');
}

/** The name a node shows in the dialog: names only, "Everything" for the all node. */
export function accessNodeName(node: AccessNode, t: TFunction): string {
  if (node.type === 'all') return everythingLabel(t);
  return node.name || node.code || '';
}

/** The type column of the dialog: company, cost center group or cost center, everything. */
export function accessNodeTypeLabel(node: AccessNode, t: TFunction): string {
  if (node.type === 'all') return t('admin:dataAccess.types.everything');
  if (node.type === 'company') return t('admin:dataAccess.types.company');
  return node.kind === 'group'
    ? t('admin:dataAccess.types.costCenterGroup')
    : t('admin:dataAccess.types.costCenter');
}

/** A node in a sentence or a list: the code of a cost center in parentheses ("Infrastructure (INF-ES)"). */
export function accessNodeReference(node: AccessNode | AccessVia, t: TFunction): string {
  if (node.type === 'all') return everythingLabel(t);
  const name = node.name || node.code || '';
  if (node.type === 'cost_center' && node.code && node.name) return `${node.name} (${node.code})`;
  return name;
}

export function accessLevelLabel(access: DataAccessLevel, t: TFunction): string {
  return t(`admin:dataAccess.access.${access}`);
}

/** The users list column: "All data", the node names joined by commas, "Limited" for an empty set. */
export function userAccessColumnText(
  dataAccess: { mode: 'all' | 'limited'; nodes: string[] } | null | undefined,
  t: TFunction,
): string {
  if (!dataAccess) return '';
  if (dataAccess.mode !== 'limited') return t('admin:dataAccess.allData');
  // A limited person holding the "all" node sees everything: the route gives the empty string.
  if (dataAccess.nodes.includes('')) return t('admin:dataAccess.allData');
  if (dataAccess.nodes.length === 0) return t('admin:dataAccess.limited');
  return dataAccess.nodes.join(', ');
}

/** The plain words of what keeps the function unavailable (spec §7.3: no backend words). */
export function missingPartsText(missing: readonly string[], t: TFunction): string {
  const keyOf = (part: string) => {
    switch (part) {
      case 'schema_create': return 'schemaCreate';
      default: return part;
    }
  };
  const parts = missing.map((part) => t(`admin:dataAccess.missingParts.${keyOf(part)}`, { defaultValue: part }));
  return t('admin:dataAccess.missing', { items: parts.join(', ') });
}
