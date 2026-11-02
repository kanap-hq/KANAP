export type RequestWorkspaceTabKey = 'summary' | 'analysis' | 'scoring' | 'relations' | 'knowledge' | 'history';
export type ProjectWorkspaceTabKey = 'summary' | 'tasks' | 'timeline' | 'effort' | 'scoring' | 'relations' | 'knowledge' | 'history';

const REQUEST_SHARED_INCLUDES = [
  'team',
  'company',
  'department',
  'projects',
  'dependencies',
  'origin_task',
] as const;

const PROJECT_SHARED_INCLUDES = [
  'team',
  'company',
  'department',
  'source_requests',
  'dependencies',
] as const;

function joinIncludes(values: readonly string[]) {
  return Array.from(new Set(values)).join(',');
}

export function getRequestWorkspaceInclude(tab: RequestWorkspaceTabKey) {
  switch (tab) {
    case 'summary':
      return joinIncludes([...REQUEST_SHARED_INCLUDES, 'activities', 'business_processes']);
    case 'analysis':
      return joinIncludes([...REQUEST_SHARED_INCLUDES, 'activities', 'business_processes']);
    case 'scoring':
    case 'relations':
    case 'knowledge':
    default:
      return joinIncludes(REQUEST_SHARED_INCLUDES);
  }
}

export function getProjectWorkspaceInclude(tab: ProjectWorkspaceTabKey) {
  switch (tab) {
    case 'summary':
      return joinIncludes([...PROJECT_SHARED_INCLUDES, 'activities', 'phases']);
    case 'timeline':
      return joinIncludes([...PROJECT_SHARED_INCLUDES, 'phases', 'milestones']);
    case 'effort':
      return joinIncludes([...PROJECT_SHARED_INCLUDES, 'time_entries']);
    case 'tasks':
      return joinIncludes([...PROJECT_SHARED_INCLUDES, 'phases']);
    case 'scoring':
    case 'relations':
    case 'knowledge':
    default:
      return joinIncludes(PROJECT_SHARED_INCLUDES);
  }
}
