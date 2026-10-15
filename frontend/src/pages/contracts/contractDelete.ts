import type { TFunction } from 'i18next';
import api from '../../api';
import { namesInSentence } from '../../components/finance/heldChoices';

/**
 * `POST /contracts/delete-impact`: what deleting the given contracts removes
 * (`backend/src/contracts/contracts-delete.service.ts`). The linked objects count once each.
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
  compliance_items: number;
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
  ['tasks', 'tasks'],
] as const;

/** What belongs to the contract: it goes with it. */
const REMOVED = [
  ['links', 'links'],
  ['attachments', 'attachments'],
  ['compliance_items', 'complianceItems'],
] as const;

/**
 * The confirmation's text: the links removed, then what is deleted with the contracts, with their
 * counts. Null when the contracts have no link and hold nothing (no confirmation is needed).
 */
export function contractDeleteImpactText(t: TFunction, locale: string, impact: ContractDeleteImpact): string | null {
  const counted = (kinds: ReadonlyArray<readonly [keyof ContractDeleteImpact, string]>) => kinds
    .filter(([field]) => impact[field] > 0)
    .map(([field, key]) => t(`contracts.delete.kinds.${key}`, { count: impact[field] }) as string);
  const detached = counted(DETACHED);
  const removed = counted(REMOVED);
  if (detached.length === 0 && removed.length === 0) return null;
  return [
    detached.length > 0 ? t('contracts.delete.detached', { items: namesInSentence(locale, detached) }) : null,
    removed.length > 0 ? t('contracts.delete.removed', { items: namesInSentence(locale, removed) }) : null,
    t('contracts.delete.cannotUndo'),
  ].filter(Boolean).join(' ');
}
