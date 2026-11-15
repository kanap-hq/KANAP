import type { AiMutationPreview } from './aiTypes';

/**
 * A card the person can approve: pending, and not an import whose check refuses the file or finds
 * nothing to import (the server refuses it alone, and leaves it out of a batch). "Approve all" takes
 * these cards only.
 */
export function isApprovable(preview: AiMutationPreview): boolean {
  const validation = preview.import_mapping?.validation;
  return preview.status === 'pending' && validation?.ok !== false && validation?.nothing_to_import !== true;
}
