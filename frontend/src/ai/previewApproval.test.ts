import { describe, expect, it } from 'vitest';
import type { AiMutationPreview } from './aiTypes';
import { isApprovable } from './previewApproval';

function card(validation: Record<string, unknown> | undefined, status = 'pending'): AiMutationPreview {
  return { status, import_mapping: validation ? { validation } : undefined } as unknown as AiMutationPreview;
}

describe('isApprovable', () => {
  it('takes a pending card whose check passed with something to import', () => {
    expect(isApprovable(card({ ok: true, inserted: 2, updated: 0 }))).toBe(true);
    expect(isApprovable(card(undefined))).toBe(true);
  });

  it('leaves out a card whose check refused the file, or with nothing to import', () => {
    expect(isApprovable(card({ ok: false }))).toBe(false);
    expect(isApprovable(card({ ok: true, nothing_to_import: true, inserted: 0, updated: 0 }))).toBe(false);
  });

  it('leaves out a card that is no longer pending', () => {
    expect(isApprovable(card({ ok: true }, 'executed'))).toBe(false);
  });
});
