import api from '../api';
import type { DeleteCheck } from '../components/DeleteSelectedButton';

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
