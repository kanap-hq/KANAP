import type { AiMutationPreview } from './aiTypes';

/**
 * A card the person can approve: pending, and not an import whose check refuses the file (the
 * server refuses it too). "Approve all" takes these cards only.
 */
export function isApprovable(preview: AiMutationPreview): boolean {
  return preview.status === 'pending' && preview.import_mapping?.validation?.ok !== false;
}
