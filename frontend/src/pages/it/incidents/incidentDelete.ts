import type { TFunction } from 'i18next';
import api from '../../../api';
import type { DeleteCheck } from '../../../components/DeleteSelectedButton';
import { namesInSentence } from '../../../components/finance/heldChoices';

/**
 * `POST /incidents/delete-check`: what deleting the given incidents removes
 * (`backend/src/incidents/services/incidents-delete.service.ts`), for the `incidents` that can go.
 * `refused`: the incidents holding regulatory reporting data, as the bulk delete reports them.
 */
export type IncidentDeleteImpact = {
  incidents: number;
  review_documents: number;
  tasks: number;
  entries: number;
  attachments: number;
  applications: number;
  assets: number;
  documents: number;
  blocked: number;
  refused: Array<{ id: string; name: string; code: string; usages: Array<{ type: string; total: number }> }>;
};

export async function fetchIncidentDeleteImpact(ids: string[]): Promise<IncidentDeleteImpact> {
  return (await api.post<IncidentDeleteImpact>('/incidents/delete-check', { ids })).data;
}

type CountField = 'review_documents' | 'tasks' | 'entries' | 'attachments' | 'applications' | 'assets' | 'documents';

/** What belongs to the incident: it goes with it. */
const REMOVED = [
  ['review_documents', 'reviewDocuments'],
  ['tasks', 'tasks'],
  ['entries', 'entries'],
  ['attachments', 'attachments'],
] as const;

/** Linked objects: they lose their link and stay. */
const DETACHED = [
  ['applications', 'applications'],
  ['assets', 'assets'],
  ['documents', 'documents'],
] as const;

/**
 * The confirmation's text: what is deleted with the incidents, then the links removed, with their
 * counts, or that they hold nothing. `dependants`: something besides the incidents goes or loses
 * its link (the confirmation then reads "Delete anyway").
 */
export function incidentDeleteImpactText(t: TFunction, locale: string, impact: IncidentDeleteImpact): { text: string; dependants: boolean } {
  const counted = (kinds: ReadonlyArray<readonly [CountField, string]>) => kinds
    .filter(([field]) => impact[field] > 0)
    .map(([field, key]) => t(`it:pages.incidents.delete.kinds.${key}`, { count: impact[field] }) as string);
  const removed = counted(REMOVED);
  const detached = counted(DETACHED);
  const dependants = removed.length > 0 || detached.length > 0;
  const parts: string[] = [];
  if (dependants) {
    if (removed.length > 0) parts.push(t('it:pages.incidents.delete.removed', { items: namesInSentence(locale, removed) }));
    if (detached.length > 0) parts.push(t('it:pages.incidents.delete.detached', { items: namesInSentence(locale, detached) }));
    parts.push(t('it:pages.incidents.delete.cannotUndo'));
  } else if (impact.incidents > 0) {
    parts.push(t('it:pages.incidents.delete.nothingLinked', { count: impact.incidents }));
  }
  return { text: parts.join(' '), dependants };
}

/** The list's check before its delete dialog (`DeleteSelectedButton.checkDelete`). */
export async function incidentDeleteCheck(ids: string[], t: TFunction, locale: string): Promise<DeleteCheck> {
  const impact = await fetchIncidentDeleteImpact(ids);
  const { text, dependants } = incidentDeleteImpactText(t, locale, impact);
  return {
    refused: impact.refused,
    warning: text || undefined,
    confirmLabel: dependants ? t('it:pages.incidents.delete.confirmAnyway') : undefined,
  };
}
