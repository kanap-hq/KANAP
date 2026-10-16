import api from '../../api';
import type { DeleteCheck } from '../../components/DeleteSelectedButton';
import type { DeleteFailure } from '../../utils/deleteRefusal';

/**
 * `POST /applications/delete-check`: the applications a delete refuses (they have interfaces), and
 * what the others take with them (`removes`: their deployments, counted).
 */
export async function applicationDeleteCheck(ids: string[]): Promise<{ refused: DeleteCheck['refused']; removes: NonNullable<DeleteFailure['usages']> }> {
  const res = await api.post<{ refused?: DeleteCheck['refused']; removes?: DeleteFailure['usages'] }>('/applications/delete-check', { ids });
  return {
    refused: Array.isArray(res.data?.refused) ? res.data.refused : [],
    removes: Array.isArray(res.data?.removes) ? res.data.removes : [],
  };
}
