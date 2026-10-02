import {
  ENTITY_TASK_LIST_QUERY_KEYS,
  copyEntityTaskListFilters,
  entityTaskListFiltersSearch,
} from './entityTaskList';

export type RelatedKind = 'project' | 'spend_item' | 'capex_item' | 'contract' | 'incident';

export type TaskOrigin =
  | { kind: 'tasks' }
  | { kind: RelatedKind; id: string; tab?: string };

export type TaskParent = {
  type: RelatedKind;
  id: string;
  name: string;
} | null;

export type TaskCrumb = {
  key: 'origin' | 'parent';
  label: string;
  href: string;
  variant: 'back' | 'link';
};

export const ORIGIN_QUERY_KEYS = [
  'projectId',
  'projectTab',
  'projectSort',
  'projectQ',
  'projectFilters',
  'projectCtx',
  'projectScope',
  'projectInvolvedUserId',
  'projectInvolvedTeamId',
  'spendItemId',
  'capexItemId',
  'contractId',
  'incidentId',
  'originTab',
  'phaseId',
  ...ENTITY_TASK_LIST_QUERY_KEYS,
] as const;

export const PROJECT_ORIGIN_TABS = new Set([
  'summary',
  'overview',
  'activity',
  'team',
  'timeline',
  'effort',
  'tasks',
  'scoring',
  'relations',
  'knowledge',
]);

export const SPEND_ORIGIN_TABS = new Set(['overview', 'budget', 'allocations', 'relations']);
export const CAPEX_ORIGIN_TABS = new Set(['overview', 'budget', 'allocations', 'relations']);
export const CONTRACT_ORIGIN_TABS = new Set(['overview', 'details', 'relations', 'tasks']);
export const INCIDENT_ORIGIN_TABS = new Set(['overview', 'journal', 'relations', 'documents', 'attachments']);

const ORIGIN_TAB_SETS: Record<RelatedKind, Set<string>> = {
  project: PROJECT_ORIGIN_TABS,
  spend_item: SPEND_ORIGIN_TABS,
  capex_item: CAPEX_ORIGIN_TABS,
  contract: CONTRACT_ORIGIN_TABS,
  incident: INCIDENT_ORIGIN_TABS,
};

const ORIGIN_TAB_DEFAULTS: Record<RelatedKind, string> = {
  project: 'tasks',
  spend_item: 'overview',
  capex_item: 'overview',
  contract: 'tasks',
  incident: 'relations',
};

const ORIGIN_ID_PARAMS: Record<RelatedKind, string> = {
  project: 'projectId',
  spend_item: 'spendItemId',
  capex_item: 'capexItemId',
  contract: 'contractId',
  incident: 'incidentId',
};

const ORIGIN_PATH_TAB_PATTERNS: Record<RelatedKind, RegExp> = {
  project: /^\/portfolio\/projects\/[^/]+\/([^/?#]+)/,
  spend_item: /^\/ops\/opex\/[^/]+\/([^/?#]+)/,
  capex_item: /^\/ops\/capex\/[^/]+\/([^/?#]+)/,
  contract: /^\/ops\/contracts\/[^/]+\/([^/?#]+)/,
  incident: /^\/it\/incidents\/[^/]+\/([^/?#]+)/,
};

export function sanitizeOriginTab(kind: RelatedKind, tab: string | null | undefined): string {
  const trimmed = (tab || '').trim();
  if (trimmed && ORIGIN_TAB_SETS[kind].has(trimmed)) return trimmed;
  return ORIGIN_TAB_DEFAULTS[kind];
}

export function parseTaskOrigin(search: URLSearchParams): TaskOrigin {
  const projectId = search.get('projectId')?.trim();
  if (projectId) {
    return { kind: 'project', id: projectId, tab: sanitizeOriginTab('project', search.get('projectTab')) };
  }

  const spendItemId = search.get('spendItemId')?.trim();
  if (spendItemId) {
    return { kind: 'spend_item', id: spendItemId, tab: sanitizeOriginTab('spend_item', search.get('originTab')) };
  }

  const capexItemId = search.get('capexItemId')?.trim();
  if (capexItemId) {
    return { kind: 'capex_item', id: capexItemId, tab: sanitizeOriginTab('capex_item', search.get('originTab')) };
  }

  const contractId = search.get('contractId')?.trim();
  if (contractId) {
    return { kind: 'contract', id: contractId, tab: sanitizeOriginTab('contract', search.get('originTab')) };
  }

  const incidentId = search.get('incidentId')?.trim();
  if (incidentId) {
    return { kind: 'incident', id: incidentId, tab: sanitizeOriginTab('incident', search.get('originTab')) };
  }

  return { kind: 'tasks' };
}

export function stripOriginParams(search: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(search);
  for (const key of ORIGIN_QUERY_KEYS) next.delete(key);
  return next;
}

export function remapProjectListContext(search: URLSearchParams): URLSearchParams {
  const sp = new URLSearchParams();
  const projectSort = search.get('projectSort');
  const projectQ = search.get('projectQ');
  const projectFilters = search.get('projectFilters');
  const projectCtx = projectFilters ? null : search.get('projectCtx');
  const projectScope = search.get('projectScope');
  const projectInvolvedUserId = search.get('projectInvolvedUserId');
  const projectInvolvedTeamId = search.get('projectInvolvedTeamId');
  if (projectSort) sp.set('sort', projectSort);
  if (projectQ) sp.set('q', projectQ);
  if (projectFilters) sp.set('filters', projectFilters);
  if (projectCtx) sp.set('ctx', projectCtx);
  if (projectScope) sp.set('projectScope', projectScope);
  if (projectInvolvedUserId) sp.set('involvedUserId', projectInvolvedUserId);
  if (projectInvolvedTeamId) sp.set('involvedTeamId', projectInvolvedTeamId);
  copyEntityTaskListFilters(search, sp);
  return sp;
}

export function buildOriginPath(origin: TaskOrigin, search: URLSearchParams): string {
  if (origin.kind === 'tasks') {
    const qs = stripOriginParams(search).toString();
    return `/portfolio/tasks${qs ? `?${qs}` : ''}`;
  }

  const tab = sanitizeOriginTab(origin.kind, origin.tab);
  if (origin.kind === 'project') {
    const qs = remapProjectListContext(search).toString();
    return `/portfolio/projects/${origin.id}/${tab}${qs ? `?${qs}` : ''}`;
  }
  const filterQs = entityTaskListFiltersSearch(search);
  if (origin.kind === 'spend_item') return `/ops/opex/${origin.id}/${tab}${filterQs ? `?${filterQs}` : ''}`;
  if (origin.kind === 'capex_item') return `/ops/capex/${origin.id}/${tab}${filterQs ? `?${filterQs}` : ''}`;
  if (origin.kind === 'incident') return `/it/incidents/${origin.id}/${tab}${filterQs ? `?${filterQs}` : ''}`;
  return `/ops/contracts/${origin.id}/${tab}${filterQs ? `?${filterQs}` : ''}`;
}

export function buildParentPath(type: RelatedKind, id: string): string {
  switch (type) {
    case 'project':
      return `/portfolio/projects/${id}/summary`;
    case 'spend_item':
      return `/ops/opex/${id}/overview`;
    case 'capex_item':
      return `/ops/capex/${id}/overview`;
    case 'contract':
      return `/ops/contracts/${id}/overview`;
    case 'incident':
      return `/it/incidents/${id}/overview`;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function looksLikeUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function sameEntityId(left: string, right: string): boolean {
  return left === right || left.toLowerCase() === right.toLowerCase();
}

export function originMatchesParent(
  origin: TaskOrigin,
  parent: TaskParent,
  originName?: string | null,
): boolean {
  if (!parent || origin.kind === 'tasks' || origin.kind !== parent.type) return false;
  if (sameEntityId(origin.id, parent.id)) return true;
  // Route refs (PRJ-6) vs stored UUIDs: same entity when the resolved names agree.
  if (looksLikeUuid(origin.id) === looksLikeUuid(parent.id)) return false;
  const originLabel = (originName || '').trim();
  const parentLabel = parent.name.trim();
  return Boolean(originLabel && parentLabel && originLabel === parentLabel);
}

export function buildTaskOriginSearchParams(
  entityType: RelatedKind,
  entityId: string,
  location: { pathname: string; search: string },
): URLSearchParams {
  const current = new URLSearchParams(location.search);
  const sp = new URLSearchParams();

  if (entityType === 'project') {
    sp.set('projectId', entityId);
    const routeTab = location.pathname.match(ORIGIN_PATH_TAB_PATTERNS.project)?.[1];
    sp.set('projectTab', sanitizeOriginTab('project', routeTab || current.get('projectTab')));
    const sort = current.get('sort');
    const q = current.get('q');
    const filters = current.get('filters');
    // Filters too long for a URL travel as a saved list context.
    const ctx = filters ? null : current.get('ctx');
    const projectScope = current.get('projectScope');
    const involvedUserId = current.get('involvedUserId');
    const involvedTeamId = current.get('involvedTeamId');
    if (sort) sp.set('projectSort', sort);
    if (q) sp.set('projectQ', q);
    if (filters) sp.set('projectFilters', filters);
    if (ctx) sp.set('projectCtx', ctx);
    if (projectScope) sp.set('projectScope', projectScope);
    if (involvedUserId) sp.set('projectInvolvedUserId', involvedUserId);
    if (involvedTeamId) sp.set('projectInvolvedTeamId', involvedTeamId);
    copyEntityTaskListFilters(current, sp);
    return sp;
  }

  sp.set(ORIGIN_ID_PARAMS[entityType], entityId);
  const routeTab = location.pathname.match(ORIGIN_PATH_TAB_PATTERNS[entityType])?.[1];
  sp.set('originTab', sanitizeOriginTab(entityType, routeTab || current.get('originTab')));
  copyEntityTaskListFilters(current, sp);
  return sp;
}

export function formatParentLabel(
  parent: NonNullable<TaskParent>,
  typeLabel: (kind: RelatedKind) => string,
): string {
  // Project and incident names already carry the business ref (PRJ-N / INC-N).
  if (parent.type === 'project' || parent.type === 'incident') return parent.name;
  return `${typeLabel(parent.type)} · ${parent.name}`;
}

export function buildTaskBreadcrumbs(args: {
  origin: TaskOrigin;
  parent: TaskParent;
  originName?: string | null;
  search?: URLSearchParams;
  labels: {
    tasks: string;
    typeLabel: (kind: RelatedKind) => string;
  };
}): TaskCrumb[] {
  const search = args.search ?? new URLSearchParams();
  const originHref = buildOriginPath(args.origin, search);
  const originLabel = args.origin.kind === 'tasks'
    ? args.labels.tasks
    : (args.originName?.trim() || args.labels.typeLabel(args.origin.kind));

  const crumbs: TaskCrumb[] = [{
    key: 'origin',
    label: originLabel,
    href: originHref,
    variant: 'back',
  }];

  if (!args.parent || originMatchesParent(args.origin, args.parent, args.originName)) return crumbs;

  crumbs.push({
    key: 'parent',
    label: formatParentLabel(args.parent, args.labels.typeLabel),
    href: buildParentPath(args.parent.type, args.parent.id),
    variant: 'link',
  });

  return crumbs;
}
