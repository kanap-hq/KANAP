import api from '../api';
import type { DeleteCheck } from '../components/DeleteSelectedButton';

/**
 * The check a list asks before its delete dialog: `POST <base>/delete-check` answers, per id, the
 * refusal the delete would give (`backend/src/common/record-in-use.ts`, suppliers and companies).
 */
export async function recordsInUseCheck(base: string, ids: string[]): Promise<DeleteCheck> {
  const res = await api.post<{ refused?: DeleteCheck['refused'] }>(`${base}/delete-check`, { ids });
  return { refused: Array.isArray(res.data?.refused) ? res.data.refused : [] };
}
