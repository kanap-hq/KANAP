import type { AiMutationPreview } from './aiTypes';

/**
 * A card the person can approve: pending, and not an import whose check refuses the file or finds
 * nothing to import (the server refuses it alone, and leaves it out of a batch). "Approve all" takes
 * these cards only.
 */
/** A card the person can reject: any pending card, a refused import included. "Reject all" takes these cards. */
export function isRejectable(preview: AiMutationPreview): boolean {
  return preview.status === 'pending';
}

export function isApprovable(preview: AiMutationPreview): boolean {
  const validation = preview.import_mapping?.validation;
  return preview.status === 'pending' && validation?.ok !== false && validation?.nothing_to_import !== true;
}
