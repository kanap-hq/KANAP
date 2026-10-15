import type { TFunction } from 'i18next';
import api from '../../api';
import { namesInSentence } from '../../components/finance/heldChoices';

/**
 * `POST /contracts/delete-impact`: what deleting the given contracts removes
 * (`backend/src/contracts/contracts-delete.service.ts`), for the `contracts` that can go; the
 * linked objects count once each. `blocked`: the contracts refused for their recorded compliance
 * requirements (`recorded_requirements` of them), which are kept.
 */
export type ContractDeleteImpact = {
  contracts: number;
  budget_lines: number;
  applications: number;
  assets: number;
  contacts: number;
  tasks: number;
  links: number;
  attachments: number;
  blocked: number;
  recorded_requirements: number;
};

export async function fetchContractDeleteImpact(ids: string[]): Promise<ContractDeleteImpact> {
  return (await api.post<ContractDeleteImpact>('/contracts/delete-impact', { ids })).data;
}

/** Linked objects: they lose their link and stay. */
const DETACHED = [
  ['budget_lines', 'budgetLines'],
  ['applications', 'applications'],
  ['assets', 'assets'],
  ['contacts', 'contacts'],
] as const;

/** What belongs to the contract: it goes with it. */
const REMOVED = [
  ['tasks', 'tasks'],
  ['links', 'links'],
  ['attachments', 'attachments'],
] as const;

/**
 * The confirmation's text: the links removed, then what is deleted with the contracts, with their
 * counts, or that they hold nothing; then the selected contracts kept for their recorded
 * requirements. `dependants`: something besides the contracts goes or loses its link (the
 * confirmation then reads "Delete anyway").
 */
export function contractDeleteImpactText(t: TFunction, locale: string, impact: ContractDeleteImpact): { text: string; dependants: boolean } {
  const counted = (kinds: ReadonlyArray<readonly [keyof ContractDeleteImpact, string]>) => kinds
    .filter(([field]) => impact[field] > 0)
    .map(([field, key]) => t(`contracts.delete.kinds.${key}`, { count: impact[field] }) as string);
  const detached = counted(DETACHED);
  const removed = counted(REMOVED);
  const dependants = detached.length > 0 || removed.length > 0;
  const parts: string[] = [];
  if (dependants) {
    if (detached.length > 0) parts.push(t('contracts.delete.detached', { items: namesInSentence(locale, detached) }));
    if (removed.length > 0) parts.push(t('contracts.delete.removed', { items: namesInSentence(locale, removed) }));
    parts.push(t('contracts.delete.cannotUndo'));
  } else if (impact.contracts > 0) {
    parts.push(t('contracts.delete.nothingLinked', { count: impact.contracts }));
  }
  if (impact.blocked > 0) parts.push(t('contracts.delete.blocked', { count: impact.blocked }));
  return { text: parts.join(' '), dependants };
}
