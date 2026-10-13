import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api';
import type { TaskStatus } from '../pages/tasks/task.constants';
import { buildTaskOriginSearchParams } from '../pages/tasks/taskWorkspaceOrigin';

/** A task of a project, a budget line, a contract or an incident, as its owner's route lists it. */
export type EntityTask = {
  id: string;
  item_number?: number | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  due_date: string | null;
  start_date: string | null;
  priority_level: string;
  assignee_user_id: string | null;
  phase_id: string | null;
};

export type EntityType = 'project' | 'spend_item' | 'capex_item' | 'contract' | 'incident';

// API endpoint for fetching tasks by entity type
const ENDPOINTS: Record<EntityType, (id: string) => string> = {
  project: (id) => `/portfolio/projects/${id}/tasks`,
  spend_item: (id) => `/spend-items/${id}/tasks`,
  capex_item: (id) => `/capex-items/${id}/tasks`,
  contract: (id) => `/contracts/${id}/tasks`,
  incident: (id) => `/incidents/${id}/tasks`,
};

/** Statuses of a task that needs no more work: listed apart in the compact section. */
export const CLOSED_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['done', 'cancelled']);

/**
 * The tasks of one entity, with the paths that open one or create one from the entity's page
 * (the task's page then offers the way back). Shared by the full tasks panel and the compact
 * section of a workspace overview.
 */
export function useEntityTasks(entityType: EntityType, entityId: string) {
  const navigate = useNavigate();
  const location = useLocation();
  const originSearchParams = React.useMemo(
    () => buildTaskOriginSearchParams(entityType, entityId, { pathname: location.pathname, search: location.search }),
    [entityId, entityType, location.pathname, location.search],
  );
  const taskPath = React.useCallback(
    (taskId: string) => {
      const qs = originSearchParams.toString();
      return `/portfolio/tasks/${taskId}${qs ? `?${qs}` : ''}`;
    },
    [originSearchParams],
  );
  const createTask = React.useCallback((phaseId?: string) => {
    const params = new URLSearchParams(originSearchParams);
    if (phaseId && entityType === 'project') params.set('phaseId', phaseId);
    navigate(`/portfolio/tasks/new/overview?${params.toString()}`);
  }, [entityType, navigate, originSearchParams]);

  const query = useQuery({
    queryKey: [`${entityType}-tasks`, entityId],
    queryFn: async () => {
      const res = await api.get<EntityTask[]>(ENDPOINTS[entityType](entityId));
      return res.data;
    },
    enabled: !!entityId,
  });

  return {
    tasks: query.data ?? [],
    isLoading: query.isLoading,
    refetch: query.refetch,
    taskPath,
    openTask: (taskId: string) => navigate(taskPath(taskId)),
    createTask,
  };
}
