import { useQuery } from '@tanstack/react-query';
import api from '../../api';
import type { ConfirmedRenewal } from './contractSchedule';

export type RenewalAction = 'renew' | 'terminate' | 'renegotiate' | 'undo';

/** `GET /contracts/:id/renewal` (`backend/src/contracts/contract-renewal.service.ts`). */
export type ContractRenewal = {
  decision_window_days: number;
  /** The end a termination proposes: the last day of the first term whose deadline has not passed. */
  proposed_end_date: string | null;
  notice_period_months: number;
  state: 'none' | 'pending' | 'decided';
  renegotiating: boolean;
  term: { term_end: string; deadline: string; renews_on: string; next_term_end: string; days_left: number } | null;
  duration_months: number;
  /** `end_date`: the end a termination chose (null: the term's last day). */
  decision: { decision: RenewalAction; reason: string | null; decided_at: string; decided_by_name: string | null; end_date?: string | null } | null;
  can_undo: boolean;
  task: { id: string; item_number: number | null; status: string; assignee_name: string | null } | null;
  /** What ending on the proposed day changes while a decision is awaited, or on the `end_date` asked. */
  impact: {
    currency: string;
    commitments: Array<{ year: number; before: number; after: number }>;
    applications: Array<{ id: string; name: string }>;
    assets: Array<{ id: string; name: string }>;
  } | null;
};

export const renewalQueryKey = (contractId: string) => ['contract-renewal', contractId] as const;

/** The renewal decision of a contract, shared by the box, the timeline and the renewal field's confirmation. */
export function useContractRenewal(contractId: string) {
  return useQuery({
    queryKey: renewalQueryKey(contractId),
    queryFn: async () => (await api.get<ContractRenewal>(`/contracts/${contractId}/renewal`)).data,
  });
}

/** The term a renewal stands for (decided, not undone), for the timeline; null otherwise. */
export function confirmedRenewalOf(data: ContractRenewal | undefined): ConfirmedRenewal | null {
  if (data?.state !== 'decided' || data.decision?.decision !== 'renew' || !data.term) return null;
  return { term_end: data.term.term_end, renews_on: data.term.renews_on, next_term_end: data.term.next_term_end };
}
