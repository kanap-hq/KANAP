import api from '../api';
import type { AiImportChoice, AiMutationPreview } from './aiTypes';

/**
 * A choice of the person on an import card makes a new card that replaces it (`replaces_preview_id`,
 * the first card of the chain). A conversation's messages keep the id of the first card: they show,
 * in its place, the newest card of its chain.
 */
export function previewChainId(preview: Pick<AiMutationPreview, 'preview_id' | 'replaces_preview_id'>): string {
  return preview.replaces_preview_id || preview.preview_id;
}

/** The newest card of each chain, in the place of its first card; the list itself when nothing was replaced. */
export function latestOfChains(previews: AiMutationPreview[]): AiMutationPreview[] {
  if (!previews.some((preview) => preview.replaces_preview_id)) return previews;
  const newest = new Map<string, AiMutationPreview>();
  for (const preview of previews) {
    const chain = previewChainId(preview);
    const current = newest.get(chain);
    if (!current || Date.parse(preview.created_at) >= Date.parse(current.created_at)) newest.set(chain, preview);
  }
  const seen = new Set<string>();
  const list: AiMutationPreview[] = [];
  for (const preview of previews) {
    const chain = previewChainId(preview);
    if (seen.has(chain)) continue;
    seen.add(chain);
    list.push(newest.get(chain)!);
  }
  return list;
}

/** The person's choices on a budget file's import card, the whole list: answers the card that replaces it. */
export async function setImportChoices(conversationId: string, previewId: string, choices: AiImportChoice[]): Promise<AiMutationPreview> {
  const response = await api.post(`/ai/conversations/${conversationId}/previews/${previewId}/import-choices`, { choices });
  return response.data as AiMutationPreview;
}
