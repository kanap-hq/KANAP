import api from '../api';

function itemCount(payload: any): number {
  if (typeof payload?.total === 'number') return payload.total;
  if (typeof payload?.total === 'string') return Number(payload.total) || 0;
  if (Array.isArray(payload?.items)) return payload.items.length;
  if (Array.isArray(payload)) return payload.length;
  return 0;
}

/** The Relations badge of an asset: `counts.total` of the tab's read, in one request. */
export async function fetchAssetRelationsCount(assetId: string): Promise<number> {
  const res = await api.get<{ counts?: { total?: number } }>(`/assets/${assetId}/relations-tab`);
  return Number(res.data?.counts?.total) || 0;
}

export async function fetchApplicationIncidentsCount(applicationId: string): Promise<number> {
  const res = await api.get('/incidents', { params: { application_id: applicationId, limit: 1 } });
  return itemCount(res.data);
}

export async function fetchProjectTasksCount(projectId: string): Promise<number> {
  const res = await api.get(`/portfolio/projects/${projectId}/tasks/status-summary`);
  return itemCount(res.data);
}


/** One relation-count request on the child API configured for the line's nature. */
export async function fetchBudgetRelationsCount(config: { itemsApi: string }, lineId: string, signal?: AbortSignal): Promise<number> {
  const res = await api.get<{ total?: number }>(`${config.itemsApi}/${lineId}/relation-counts`, { signal });
  return Number(res.data?.total) || 0;
}
