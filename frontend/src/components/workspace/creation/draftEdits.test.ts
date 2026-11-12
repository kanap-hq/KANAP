import { describe, expect, it } from 'vitest';
import { changedFields, saveEditsSince } from './draftEdits';

type Form = { name: string; city: string | null; note: string | null };

describe('changedFields', () => {
  it('names the fields that differ and none other', () => {
    const sent: Form = { name: 'Paris', city: null, note: 'a' };
    expect(changedFields(sent, { ...sent, city: 'Paris', note: 'a' }, ['name', 'city', 'note'])).toEqual({ city: 'Paris' });
    expect(changedFields(sent, { ...sent, city: 'Paris' }, ['name', 'note'])).toBeNull();
    expect(changedFields(sent, { ...sent }, ['name', 'city', 'note'])).toBeNull();
  });
});

describe('saveEditsSince', () => {
  it('saves what changed since the draft was sent, and what changes while it is saved', async () => {
    const sent: Form = { name: 'Paris', city: null, note: null };
    let current: Form = { ...sent, city: 'Pa' };
    const saved: unknown[] = [];
    await saveEditsSince({
      sent,
      now: () => current,
      fields: ['name', 'city', 'note'],
      save: async (edits) => {
        saved.push(edits);
        // Typed while the first save is under way.
        if (saved.length === 1) current = { ...current, city: 'Paris', note: 'x' };
      },
    });
    expect(saved).toEqual([{ city: 'Pa' }, { city: 'Paris', note: 'x' }]);
  });

  it('saves nothing when nothing changed, and stops on a refusal', async () => {
    const sent: Form = { name: 'Paris', city: null, note: null };
    const saved: unknown[] = [];
    await saveEditsSince({ sent, now: () => sent, fields: ['city'], save: async (edits) => { saved.push(edits); } });
    expect(saved).toEqual([]);
    await expect(saveEditsSince({
      sent,
      now: () => ({ ...sent, city: 'Lyon' }),
      fields: ['city'],
      save: async () => { throw new Error('refused'); },
    })).rejects.toThrow('refused');
  });
});
