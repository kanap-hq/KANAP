import api from '../api';

function itemCount(payload: any): number {
  if (typeof payload?.total === 'number') return payload.total;
  if (typeof payload?.total === 'string') return Number(payload.total) || 0;
  if (Array.isArray(payload?.items)) return payload.items.length;
  if (Array.isArray(payload)) return payload.length;
  return 0;
}

function settledItemCount(result: PromiseSettledResult<any>): number {
  return result.status === 'fulfilled' ? itemCount(result.value.data) : 0;
}

export async function fetchAssetRelationsCount(assetId: string): Promise<number> {
  const [assetRelations, opex, capex, contracts, projects, tasks, links, attachments, incidents] = await Promise.allSettled([
    api.get(`/assets/${assetId}/relations`),
    api.get(`/assets/${assetId}/spend-items`),
    api.get(`/assets/${assetId}/capex-items`),
    api.get(`/assets/${assetId}/contracts`),
    api.get(`/assets/${assetId}/projects`),
    api.get(`/assets/${assetId}/related-tasks`, { params: { limit: 1 } }),
    api.get(`/assets/${assetId}/links`),
    api.get(`/assets/${assetId}/attachments`),
    api.get('/incidents', { params: { asset_id: assetId, limit: 1 } }),
  ]);

  const structural = assetRelations.status === 'fulfilled'
    ? (assetRelations.value.data?.outgoing?.length || 0) + (assetRelations.value.data?.incoming?.length || 0)
    : 0;

  return structural
    + settledItemCount(opex)
    + settledItemCount(capex)
    + settledItemCount(contracts)
    + settledItemCount(projects)
    + settledItemCount(tasks)
    + settledItemCount(links)
    + settledItemCount(attachments)
    + settledItemCount(incidents);
}

export async function fetchApplicationIncidentsCount(applicationId: string): Promise<number> {
  const res = await api.get('/incidents', { params: { application_id: applicationId, limit: 1 } });
  return itemCount(res.data);
}

export async function fetchPortfolioRelationsCount(
  entityType: 'request' | 'project',
  entityId: string,
  dependenciesCount = 0,
): Promise<number> {
  const base = entityType === 'request' ? `/portfolio/requests/${entityId}` : `/portfolio/projects/${entityId}`;
  const [entity, applications, assets] = await Promise.allSettled([
    api.get(base, { params: { include: 'opex,capex,urls,attachments' } }),
    api.get(`${base}/applications`),
    api.get(`${base}/assets`),
  ]);

  const entityData = entity.status === 'fulfilled' ? entity.value.data || {} : {};

  return dependenciesCount
    + (entityData.opex_items?.length || 0)
    + (entityData.capex_items?.length || 0)
    + (entityData.urls?.length || 0)
    + (entityData.attachments?.length || 0)
    + settledItemCount(applications)
    + settledItemCount(assets);
}

export async function fetchProjectTasksCount(projectId: string): Promise<number> {
  const res = await api.get(`/portfolio/projects/${projectId}/tasks/status-summary`);
  return itemCount(res.data);
}


/** The Relations tab badge of an OPEX line: one request (`GET /spend-items/:id/relation-counts`). */
export async function fetchSpendRelationsCount(spendItemId: string, signal?: AbortSignal): Promise<number> {
  const res = await api.get<{ total?: number }>(`/spend-items/${spendItemId}/relation-counts`, { signal });
  return Number(res.data?.total) || 0;
}

/** The Relations tab badge of a CAPEX line: one request (`GET /capex-items/:id/relation-counts`). */
export async function fetchCapexRelationsCount(capexItemId: string, signal?: AbortSignal): Promise<number> {
  const res = await api.get<{ total?: number }>(`/capex-items/${capexItemId}/relation-counts`, { signal });
  return Number(res.data?.total) || 0;
}
