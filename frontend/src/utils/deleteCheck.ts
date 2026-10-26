import type { TFunction } from 'i18next';
import api from '../api';
import type { DeleteCheck } from '../components/DeleteSelectedButton';
import { assetDeleteWarningLines, type AssetDeleteWarning } from './deleteRefusal';

/**
 * The check a list asks before its delete dialog: `POST <base>/delete-check` answers, per id, the
 * refusal the delete would give (`backend/src/common/record-in-use.ts`).
 */
export async function recordsInUseCheck(base: string, ids: string[]): Promise<DeleteCheck> {
  const res = await api.post<{ refused?: DeleteCheck['refused'] }>(`${base}/delete-check`, { ids });
  return { refused: Array.isArray(res.data?.refused) ? res.data.refused : [] };
}

/**
 * The refusal the delete of one record would get, asked before its confirmation, or null. A
 * failed check is null too: the delete still refuses what it must.
 */
export async function recordRefusal(base: string, id: string): Promise<DeleteCheck['refused'][number] | null> {
  try {
    const { refused } = await recordsInUseCheck(base, [id]);
    return refused.find((refusal) => refusal.id === id) ?? null;
  } catch {
    return null;
  }
}

/**
 * The check of an asset delete: the refusals, and for the others what the delete takes with it
 * (`warnings`, which never refuse), as one note per asset (a line per case).
 */
export async function assetsDeleteCheck(ids: string[], t: TFunction, language: string): Promise<DeleteCheck> {
  const res = await api.post<{ refused?: DeleteCheck['refused']; warnings?: AssetDeleteWarning[] }>('/assets/delete-check', { ids });
  const notes: Record<string, string> = {};
  for (const warning of Array.isArray(res.data?.warnings) ? res.data.warnings : []) {
    const lines = assetDeleteWarningLines(warning, t, language);
    if (lines.length > 0) notes[warning.id] = lines.join('\n');
  }
  return {
    refused: Array.isArray(res.data?.refused) ? res.data.refused : [],
    // Something else goes with an asset: the dialog notes it and its main action says so.
    ...(Object.keys(notes).length > 0 ? { notes, confirmLabel: t('common:delete.anyway') as string } : {}),
  };
}

/**
 * What the delete of one asset would give, asked before its confirmation: the refusal (or null) and
 * the lines of its warning. A failed check answers neither: the delete still refuses what it must.
 */
export async function assetDeleteCheck(
  id: string,
  t: TFunction,
  language: string,
): Promise<{ refusal: DeleteCheck['refused'][number] | null; lines: string[] }> {
  try {
    const { refused, notes } = await assetsDeleteCheck([id], t, language);
    return { refusal: refused.find((refusal) => refusal.id === id) ?? null, lines: notes?.[id] ? notes[id].split('\n') : [] };
  } catch {
    return { refusal: null, lines: [] };
  }
}
