import api from '../api';

/** Mirrors backend/src/admin/trials/trial-funnel.ts. */
export const TRIAL_STATES = ['awaiting_activation', 'trialing', 'ended', 'converted', 'internal'] as const;
export type TrialState = (typeof TRIAL_STATES)[number];

export type DiscoveryCall = {
  scheduled_at: string | null;
  status: 'booked' | 'cancelled';
  source: 'calcom' | 'manual';
  note: string | null;
  external_id: string | null;
  updated_at: string;
};

export type TrialFunnelRow = {
  signup_id: string;
  tenant_id: string | null;
  slug: string;
  name: string;
  contact_name: string | null;
  state: TrialState;
  needs_attention: boolean;
  created_at: string;
  activated_at: string | null;
  first_sign_in_at: string | null;
  last_sign_in_at: string | null;
  angle: string | null;
  mode: string | null;
  steps_done: number | null;
  steps_total: number | null;
  sample_data_loaded_at: string | null;
  first_record_at: string | null;
  first_plaid_question_at: string | null;
  first_import_at: string | null;
  first_invitation_at: string | null;
  back_after_1_day_at: string | null;
  back_after_7_days_at: string | null;
  trial_end: string | null;
  converted_at: string | null;
  discovery_call_first_click: { at: string; placement: string | null } | null;
  discovery_call: DiscoveryCall | null;
};

export type FunnelWeek = { week: string; created: number; activated: number; signed_in: number; converted: number };

export type TrialFunnel = { items: TrialFunnelRow[]; weeks: FunnelWeek[]; attention: number };

export async function listTrials(params: { state?: TrialState } = {}): Promise<TrialFunnel> {
  const res = await api.get<TrialFunnel>('/admin/trials', { params });
  return res.data;
}

export async function saveTrialDiscoveryCall(
  tenantId: string,
  body: { scheduled_at: string; status: DiscoveryCall['status']; note: string | null },
): Promise<DiscoveryCall> {
  const res = await api.put<DiscoveryCall>(`/admin/trials/${tenantId}/discovery-call`, body);
  return res.data;
}

export async function removeTrialDiscoveryCall(tenantId: string): Promise<void> {
  await api.delete(`/admin/trials/${tenantId}/discovery-call`);
}
