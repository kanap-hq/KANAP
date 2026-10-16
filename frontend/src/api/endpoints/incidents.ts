import { api } from '../client';
import { extractFilenameFromDisposition } from '../../utils/downloadBlob';

export type IncidentSeverity = 'critical' | 'major' | 'minor' | 'low';
export type IncidentStatus = 'open' | 'in_progress' | 'resolved' | 'closed' | 'cancelled';
export type IncidentEntryKind = 'note' | 'status_change' | 'severity_change' | 'reopen' | 'link_change' | 'system';

export const INCIDENT_SEVERITIES: IncidentSeverity[] = ['critical', 'major', 'minor', 'low'];
export const INCIDENT_STATUSES: IncidentStatus[] = ['open', 'in_progress', 'resolved', 'closed', 'cancelled'];

/**
 * Incident row as returned by the list endpoint (GET /incidents)
 */
export interface IncidentRow {
  id: string;
  item_number: number;
  title: string;
  category: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  started_at: string | null;
  detected_at: string;
  resolved_at: string | null;
  closed_at: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  reporter_user_id: string | null;
  reporter_name: string | null;
  confidential?: boolean;
  asset_count: number;
  application_count: number;
  task_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Full incident (GET /incidents/:id)
 */
export interface Incident extends IncidentRow {
  confidential: boolean;
  /** Short summary. The full account lives in the `incidents:review` integrated document. */
  description: string | null;
  source_ref: string | null;
  personal_data_affected: boolean;
  authority_notification_required: boolean;
  authority_notified_at: string | null;
  notified_parties: string | null;
  created_by: string | null;
  updated_by: string | null;
  counts: {
    entries: number;
    assets: number;
    applications: number;
    technologies?: number;
    tasks: number;
    documents: number;
    attachments: number;
  };
}

/**
 * Fields accepted by POST /incidents and PATCH /incidents/:id
 */
export type IncidentEditableFields = Pick<Incident,
  | 'title'
  | 'category'
  | 'severity'
  | 'status'
  | 'started_at'
  | 'detected_at'
  | 'resolved_at'
  | 'closed_at'
  | 'reporter_user_id'
  | 'owner_user_id'
  | 'description'
  | 'source_ref'
  | 'personal_data_affected'
  | 'authority_notification_required'
  | 'authority_notified_at'
  | 'notified_parties'
  | 'confidential'
>;

export type CreateIncidentInput = Partial<IncidentEditableFields> & {
  title: string;
  severity: IncidentSeverity;
};

export type UpdateIncidentInput = Partial<IncidentEditableFields>;

/**
 * List envelope (GET /incidents) — same shape as the other ServerDataGrid endpoints
 */
export interface IncidentListResponse {
  items: IncidentRow[];
  total: number;
  page: number;
  limit: number;
}

export interface IncidentListParams {
  page?: number;
  limit?: number;
  sort?: string;
  q?: string;
  filters?: string;
  asset_id?: string;
  application_id?: string;
}

/**
 * Append-only journal entry (GET /incidents/:id/entries)
 */
export interface IncidentEntry {
  id: string;
  incident_id: string;
  kind: IncidentEntryKind;
  content: string | null;
  changed_fields: Record<string, { from: unknown; to: unknown }> | null;
  occurred_at: string;
  author_id: string | null;
  author_name: string | null;
  created_at: string;
}

/**
 * Linked asset, application or technology (GET /incidents/:id/assets | /applications | /technologies)
 */
export interface IncidentLinkedObject {
  id: string;
  name: string;
  reference: string | null;
}

/**
 * Attachment (GET /incidents/:id/attachments) — same fields as task attachments
 */
export interface IncidentAttachment {
  id: string;
  incident_id: string;
  original_filename: string;
  mime_type: string | null;
  size: number;
  uploaded_at: string;
}

/**
 * Incidents API endpoints
 */
export const incidentsApi = {
  list: (params: IncidentListParams = {}): Promise<IncidentListResponse> =>
    api.get<IncidentListResponse>('/incidents', { params }),

  get: (idOrRef: string): Promise<Incident> =>
    api.get<Incident>(`/incidents/${idOrRef}`),

  create: (data: CreateIncidentInput): Promise<Incident> =>
    api.post<Incident, CreateIncidentInput>('/incidents', data),

  update: (idOrRef: string, data: UpdateIncidentInput): Promise<Incident> =>
    api.patch<Incident, UpdateIncidentInput>(`/incidents/${idOrRef}`, data),

  reopen: (idOrRef: string, reason: string): Promise<Incident> =>
    api.post<Incident>(`/incidents/${idOrRef}/reopen`, { reason }),

  cancel: (idOrRef: string, reason: string): Promise<Incident> =>
    api.post<Incident>(`/incidents/${idOrRef}/cancel`, { reason }),

  setConfidentiality: (idOrRef: string, confidential: boolean): Promise<Incident> =>
    api.post<Incident>(`/incidents/${idOrRef}/confidentiality`, { confidential }),

  listEntries: (idOrRef: string): Promise<IncidentEntry[]> =>
    api.get<IncidentEntry[]>(`/incidents/${idOrRef}/entries`),

  createEntry: (idOrRef: string, data: { content: string; occurred_at?: string }): Promise<IncidentEntry> =>
    api.post<IncidentEntry>(`/incidents/${idOrRef}/entries`, data),

  listAssets: (idOrRef: string): Promise<IncidentLinkedObject[]> =>
    api.get<IncidentLinkedObject[]>(`/incidents/${idOrRef}/assets`),

  replaceAssets: (idOrRef: string, assetIds: string[]): Promise<IncidentLinkedObject[]> =>
    api.post<IncidentLinkedObject[]>(`/incidents/${idOrRef}/assets/bulk-replace`, { asset_ids: assetIds }),

  listApplications: (idOrRef: string): Promise<IncidentLinkedObject[]> =>
    api.get<IncidentLinkedObject[]>(`/incidents/${idOrRef}/applications`),

  replaceApplications: (idOrRef: string, applicationIds: string[]): Promise<IncidentLinkedObject[]> =>
    api.post<IncidentLinkedObject[]>(`/incidents/${idOrRef}/applications/bulk-replace`, { application_ids: applicationIds }),

  listTechnologies: (idOrRef: string): Promise<IncidentLinkedObject[]> =>
    api.get<IncidentLinkedObject[]>(`/incidents/${idOrRef}/technologies`),

  replaceTechnologies: (idOrRef: string, technologyIds: string[]): Promise<IncidentLinkedObject[]> =>
    api.post<IncidentLinkedObject[]>(`/incidents/${idOrRef}/technologies/bulk-replace`, { technology_ids: technologyIds }),

  listAttachments: (idOrRef: string): Promise<IncidentAttachment[]> =>
    api.get<IncidentAttachment[]>(`/incidents/${idOrRef}/attachments`),

  uploadAttachment: (idOrRef: string, file: File): Promise<IncidentAttachment> => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<IncidentAttachment, FormData>(`/incidents/${idOrRef}/attachments`, formData);
  },

  deleteAttachment: (attachmentId: string): Promise<void> =>
    api.patch<void>(`/incidents/attachments/${attachmentId}/delete`),

  exportReport: async (idOrRef: string, lang: string, timeZone?: string): Promise<{ blob: Blob; filename: string | null }> => {
    const response = await api.getAxiosInstance().get<Blob>(`/incidents/${idOrRef}/report`, {
      params: { lang, tz: timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone },
      responseType: 'blob',
    });
    return {
      blob: response.data,
      filename: extractFilenameFromDisposition(response.headers?.['content-disposition']),
    };
  },
};
