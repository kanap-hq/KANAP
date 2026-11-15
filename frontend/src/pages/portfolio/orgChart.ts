/**
 * Reporting line of the contributors, built entirely in the browser from the
 * rows the contributors list already loads. `manager_user_id` points at a
 * *user*, so the nodes are indexed by `user_id`; a manager who is not a
 * contributor has no node, which makes their report a root.
 *
 * Filtering a contract type out, or leaving disabled accounts out, does not cut
 * the branch below: the reports walk up until they find a visible ancestor and
 * attach there, keeping the trail of skipped managers for the "via" hint.
 */
import { formatItemRef } from '../../utils/item-ref';

export type OrgContributor = {
  id: string;
  item_number: number;
  user_id: string;
  user_display_name: string;
  user_email: string;
  job_title?: string | null;
  /** Account status of the underlying user, from the contributors endpoint. */
  user_status?: string | null;
  manager_user_id?: string | null;
  employment_type_id?: string | null;
  employment_type_name?: string | null;
  skills?: { skill_id: string; proficiency: number }[] | null;
};

export type OrgNode = {
  /** Contributor config id: unique, and what the collapse state is keyed on. */
  key: string;
  contributor: OrgContributor;
  /** MEM-N, the only reference shown to a reader or written to the address. */
  reference: string;
  name: string;
  /** 0 for a root of the chart. */
  depth: number;
  /** Managers skipped on the way to the parent, nearest first. */
  via: string[];
  children: OrgNode[];
};

export type OrgForest = {
  roots: OrgNode[];
  /** Every rendered node, parents before children. */
  nodes: OrgNode[];
  /** Contributors the filters keep, in list order: the root picker's options. */
  eligible: OrgContributor[];
  /** A root was asked for and no visible contributor carries that reference. */
  rootMissing: boolean;
};

export type BuildOrgForestOptions = {
  contributors: OrgContributor[];
  /** Contract types switched off in the control bar, by id. */
  hiddenEmploymentTypeIds?: string[];
  includeDisabled?: boolean;
  /** MEM-N the chart is rooted on; a forest when absent or unknown. */
  rootReference?: string | null;
  /** Levels kept below the root; all of them when null. */
  maxDepth?: number | null;
};

/** Search parameters the org chart owns, cleared when the view is left. */
export const ORG_CHART_PARAMS = ['root', 'hide', 'depth', 'disabled'] as const;

const DISABLED_STATUS = 'disabled';

/** Names only, e-mail as the degraded fallback — same rule as every other list. */
export function contributorName(contributor: OrgContributor): string {
  return contributor.user_display_name?.trim() || contributor.user_email;
}

export function orgReference(contributor: OrgContributor): string {
  return formatItemRef('contributor', contributor.item_number);
}

export function buildOrgForest(options: BuildOrgForestOptions): OrgForest {
  const {
    contributors,
    hiddenEmploymentTypeIds = [],
    includeDisabled = false,
    rootReference = null,
    maxDepth = null,
  } = options;

  const hiddenTypes = new Set(hiddenEmploymentTypeIds);
  const isVisible = (contributor: OrgContributor) => (
    (includeDisabled || contributor.user_status !== DISABLED_STATUS)
    && !(contributor.employment_type_id && hiddenTypes.has(contributor.employment_type_id))
  );

  // Every contributor, visible or not: the walk needs the hidden ones to know
  // where their reports belong.
  const byUserId = new Map<string, OrgContributor>();
  for (const contributor of contributors) byUserId.set(contributor.user_id, contributor);

  const eligible = contributors.filter(isVisible);

  const parentOf = new Map<string, string>();
  const viaOf = new Map<string, string[]>();
  for (const contributor of eligible) {
    const via: string[] = [];
    const seen = new Set<string>([contributor.user_id]);
    let cursor = contributor.manager_user_id || null;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const manager = byUserId.get(cursor);
      // The manager is not a contributor: the walk ends and this is a root.
      if (!manager) break;
      if (isVisible(manager)) {
        parentOf.set(contributor.id, manager.id);
        break;
      }
      via.push(contributorName(manager));
      cursor = manager.manager_user_id || null;
    }
    if (via.length > 0) viaOf.set(contributor.id, via);
  }

  // The server refuses to write a cycle, but an inherited row could still close
  // one, and a cycle leaves everyone in it out of every tree. Cut it at the
  // first contributor that closes a loop so nobody disappears from the chart.
  for (const contributor of eligible) {
    const seen = new Set<string>([contributor.id]);
    let cursor = parentOf.get(contributor.id);
    while (cursor) {
      if (seen.has(cursor)) {
        parentOf.delete(contributor.id);
        break;
      }
      seen.add(cursor);
      cursor = parentOf.get(cursor);
    }
  }

  const nodeById = new Map<string, OrgNode>();
  for (const contributor of eligible) {
    nodeById.set(contributor.id, {
      key: contributor.id,
      contributor,
      reference: orgReference(contributor),
      name: contributorName(contributor),
      depth: 0,
      via: viaOf.get(contributor.id) ?? [],
      children: [],
    });
  }

  let roots: OrgNode[] = [];
  for (const contributor of eligible) {
    const node = nodeById.get(contributor.id)!;
    const parentId = parentOf.get(contributor.id);
    const parent = parentId ? nodeById.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  let rootMissing = false;
  if (rootReference) {
    const target = eligible.find((contributor) => orgReference(contributor) === rootReference);
    const node = target ? nodeById.get(target.id) : undefined;
    if (node) {
      // A branch chart starts clean: the hint described a parent that is gone.
      node.via = [];
      roots = [node];
    } else {
      rootMissing = true;
    }
  }

  const nodes: OrgNode[] = [];
  const visited = new Set<string>();
  const walk = (node: OrgNode, depth: number): OrgNode => {
    visited.add(node.key);
    node.depth = depth;
    nodes.push(node);
    const kept: OrgNode[] = [];
    if (maxDepth === null || depth < maxDepth) {
      for (const child of node.children) {
        if (visited.has(child.key)) continue;
        kept.push(walk(child, depth + 1));
      }
    }
    node.children = kept;
    return node;
  };
  for (const root of roots) walk(root, 0);

  return { roots, nodes, eligible, rootMissing };
}
