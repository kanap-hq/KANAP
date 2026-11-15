import { describe, expect, it } from 'vitest';
import type { AiMutationPreview } from '../aiTypes';
import { latestOfChains, previewChainId } from '../previewChains';

const card = (id: string, created: string, over: Partial<AiMutationPreview> = {}) => ({
  preview_id: id,
  status: 'pending',
  created_at: created,
  ...over,
}) as AiMutationPreview;

describe('previewChains', () => {
  it('names a chain by its first card', () => {
    expect(previewChainId(card('a', '2026-11-15T10:00:00Z'))).toBe('a');
    expect(previewChainId(card('b', '2026-11-15T10:01:00Z', { replaces_preview_id: 'a' }))).toBe('a');
  });

  it('keeps the newest card of each chain, in the place of its first card', () => {
    const first = card('a', '2026-11-15T10:00:00Z', { status: 'expired' });
    const other = card('x', '2026-11-15T10:00:30Z');
    const second = card('b', '2026-11-15T10:01:00Z', { replaces_preview_id: 'a', status: 'expired' });
    const third = card('c', '2026-11-15T10:02:00Z', { replaces_preview_id: 'a' });
    expect(latestOfChains([first, other, third, second]).map((item) => item.preview_id)).toEqual(['c', 'x']);
    // Without a replacement the list stays as it is.
    const plain = [first, other];
    expect(latestOfChains(plain)).toBe(plain);
  });
});
