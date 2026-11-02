import { useMemo } from 'react';
import type { Options } from 'react-markdown';
import { useAuth } from '../../auth/AuthContext';
import { buildEntityUrl } from './entityUrls';

/**
 * The reference families whose workspace page opens by the reference itself (`/it/incidents/INC-26`),
 * with the right the route asks for (ProtectedRoute).
 *
 * Checked on the detail routes and the reads behind them. Contracts have no numbered reference,
 * and a CVE id is not a record page: both stay text. `CTR-n` is a contributor, not a contract
 * (the mention token CTR filters contracts, which do not open by that reference).
 */
const LINKED_REFERENCE_FAMILIES: Record<string, { entityType: string; resource: string }> = {
  APP: { entityType: 'applications', resource: 'applications' },
  AST: { entityType: 'assets', resource: 'infrastructure' },
  INT: { entityType: 'interfaces', resource: 'applications' },
  TEC: { entityType: 'technologies', resource: 'infrastructure' },
  INC: { entityType: 'incidents', resource: 'incidents' },
  CONN: { entityType: 'connections', resource: 'infrastructure' },
  LOC: { entityType: 'locations', resource: 'locations' },
  T: { entityType: 'tasks', resource: 'tasks' },
  PRJ: { entityType: 'projects', resource: 'portfolio_projects' },
  REQ: { entityType: 'requests', resource: 'portfolio_requests' },
  DOC: { entityType: 'documents', resource: 'knowledge' },
  CTR: { entityType: 'contributors', resource: 'portfolio_settings' },
  BL: { entityType: 'budget_lines', resource: 'budget' },
  OPX: { entityType: 'budget_lines', resource: 'budget' },
  CPX: { entityType: 'budget_lines', resource: 'budget' },
};

/** Contributors are absent from `buildEntityUrl`: that table's CTR token is the contracts mention filter. */
function referenceUrl(entityType: string, reference: string): string | null {
  if (entityType === 'contributors') return `/portfolio/contributors/${reference}`;
  return buildEntityUrl(entityType, reference);
}

// A KANAP reference number never starts with 0: `APP-01` is part of a name such as `PAR-APP-01`.
const REFERENCE_PATTERN = new RegExp(
  `(?<![\\w/-])(${Object.keys(LINKED_REFERENCE_FAMILIES).join('|')})-[1-9]\\d*(?![\\w-])`,
  'g',
);

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  title?: string | null;
  children?: MarkdownNode[];
};

type ReferenceLinkOptions = {
  /** Whether the person may open the pages that ask for this right. */
  canRead: (resource: string) => boolean;
};

function linkedText(value: string, options: ReferenceLinkOptions): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let last = 0;
  for (const match of value.matchAll(REFERENCE_PATTERN)) {
    const reference = match[0];
    const family = LINKED_REFERENCE_FAMILIES[match[1]];
    const url = family && options.canRead(family.resource) ? referenceUrl(family.entityType, reference) : null;
    if (!url) continue;
    const start = match.index ?? 0;
    if (start > last) nodes.push({ type: 'text', value: value.slice(last, start) });
    nodes.push({ type: 'link', url, title: null, children: [{ type: 'text', value: reference }] });
    last = start + reference.length;
  }
  if (last === 0) return [{ type: 'text', value }];
  if (last < value.length) nodes.push({ type: 'text', value: value.slice(last) });
  return nodes;
}

function linkReferencesIn(node: MarkdownNode, options: ReferenceLinkOptions): void {
  // A link keeps its own text. Code is a leaf (`value`, not children); named here so a
  // child added under a code node is still left as text.
  if (
    !node.children
    || node.type === 'link'
    || node.type === 'linkReference'
    || node.type === 'code'
    || node.type === 'inlineCode'
  ) return;
  node.children = node.children.flatMap((child) => {
    if (child.type === 'text' && child.value) return linkedText(child.value, options);
    linkReferencesIn(child, options);
    return [child];
  });
}

/** Remark plugin: a business reference in the text (`APP-36`, `BL-113`) opens its record. */
export function remarkReferenceLinks(options: ReferenceLinkOptions) {
  return (tree: MarkdownNode) => linkReferencesIn(tree, options);
}

/** The remark plugins that link the references the signed-in person may open. */
export function useReferenceLinkPlugins(): NonNullable<Options['remarkPlugins']> {
  const { hasLevel } = useAuth();
  return useMemo(
    () => [[remarkReferenceLinks, { canRead: (resource: string) => hasLevel(resource, 'reader') }]],
    [hasLevel],
  );
}
