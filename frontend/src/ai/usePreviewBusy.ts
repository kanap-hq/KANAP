import { useCallback, useState } from 'react';
import type { AiMutationPreview } from './aiTypes';
import { previewChainId } from './previewChains';

/**
 * The cards whose choices are being counted by the server (a box of a change in bulk in flight or
 * queued, an import choice), by chain: "Approve all" waits for them, as each card's own Approve does,
 * so that it never approves a card about to be replaced.
 */
export function usePreviewBusy() {
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const onBusy = useCallback((preview: AiMutationPreview, value: boolean) => {
    const chain = previewChainId(preview);
    setBusy((previous) => {
      if (previous.has(chain) === value) return previous;
      const next = new Set(previous);
      if (value) next.add(chain);
      else next.delete(chain);
      return next;
    });
  }, []);
  const anyBusy = useCallback(
    (previews: AiMutationPreview[]) => previews.some((preview) => busy.has(previewChainId(preview))),
    [busy],
  );
  return { onBusy, anyBusy };
}
