import { describe, expect, it } from 'vitest';
import { initialState, reducer } from './ItOperationsSettingsPage';
import type { ItOpsSettings } from '../../services/itOpsSettings';

const settings = {
  applicationCategories: [{ code: 'analytics', label: 'Analytics', deprecated: false }],
  accessMethods: [{ code: 'web', label: 'Web', deprecated: false }],
  serverKinds: [{ code: 'vm', label: 'Virtual machine', is_physical: false, deprecated: false }],
  operatingSystems: [], connectionTypes: [], subnets: [], domains: [],
  lockedCodes: {}, protectedCodes: { serverKinds: ['vm'] },
} as unknown as ItOpsSettings;

const strip = (rows: any[]) => rows.map(({ localId: _localId, ...row }) => row);

describe('IT Landscape settings reconciliation', () => {
  it('assigns the generated code to a new row and clears the dirty flag when the draft is unchanged', () => {
    let state = reducer(initialState, { type: 'hydrate', payload: settings });
    const draft = [{ code: '', label: 'Kiosk', deprecated: false, localId: 'new' }, ...state.enums.accessMethods];
    state = reducer(state, { type: 'setEnum', id: 'accessMethods', items: draft });
    expect(state.dirty.accessMethods).toBe(true);
    const sent = strip(draft);
    const saved = { ...settings, accessMethods: [{ code: 'kiosk', label: 'Kiosk', deprecated: false }, { code: 'web', label: 'Web', deprecated: false }] } as ItOpsSettings;
    state = reducer(state, { type: 'saved', id: 'accessMethods', sent, saved });
    expect(state.enums.accessMethods.map((row) => [row.code, row.label, row.localId])).toEqual([['kiosk', 'Kiosk', 'new'], ['web', 'Web', expect.any(String)]]);
    expect(state.dirty.accessMethods).toBe(false);
    expect((state.baseline as any).accessMethods[0].code).toBe('kiosk');
  });

  it('keeps a rename made during the first save, learns the generated code and stays dirty', () => {
    let state = reducer(initialState, { type: 'hydrate', payload: settings });
    const draft = [{ code: '', label: 'Kiosk', deprecated: false, localId: 'new' }, ...state.enums.accessMethods];
    state = reducer(state, { type: 'setEnum', id: 'accessMethods', items: draft });
    const sent = strip(draft);
    // The user renames the row while the request is in flight.
    const renamed = [{ ...draft[0], label: 'Kiosk terminal' }, draft[1]];
    state = reducer(state, { type: 'setEnum', id: 'accessMethods', items: renamed });
    const saved = { ...settings, accessMethods: [{ code: 'kiosk', label: 'Kiosk', deprecated: false }, { code: 'web', label: 'Web', deprecated: false }] } as ItOpsSettings;
    state = reducer(state, { type: 'saved', id: 'accessMethods', sent, saved });
    expect(state.enums.accessMethods[0]).toMatchObject({ code: 'kiosk', label: 'Kiosk terminal', localId: 'new' });
    expect(state.dirty.accessMethods).toBe(true);
    // A later save of the renamed draft reconciles normally.
    const saved2 = { ...settings, accessMethods: [{ code: 'kiosk', label: 'Kiosk terminal', deprecated: false }, { code: 'web', label: 'Web', deprecated: false }] } as ItOpsSettings;
    state = reducer(state, { type: 'saved', id: 'accessMethods', sent: strip(state.enums.accessMethods), saved: saved2 });
    expect(state.dirty.accessMethods).toBe(false);
  });

  it('does not touch the other lists when one list is saved', () => {
    let state = reducer(initialState, { type: 'hydrate', payload: settings });
    const categories = [{ code: '', label: 'Draft category', deprecated: false, localId: 'c' }, ...state.enums.applicationCategories];
    state = reducer(state, { type: 'setEnum', id: 'applicationCategories', items: categories });
    const saved = { ...settings, accessMethods: [{ code: 'web', label: 'Web', deprecated: false }], applicationCategories: [{ code: 'analytics', label: 'Analytics', deprecated: false }] } as ItOpsSettings;
    state = reducer(state, { type: 'saved', id: 'accessMethods', sent: strip(state.enums.accessMethods), saved });
    expect(state.enums.applicationCategories[0].label).toBe('Draft category');
    expect(state.dirty.applicationCategories).toBe(true);
  });

  it('edits the technology families like the other simple lists', () => {
    const withFamilies = { ...settings, technologyFamilies: [{ code: 'directory', label: 'Directory and identity', deprecated: false }, { code: 'database', label: 'Database', deprecated: false }] } as ItOpsSettings;
    let state = reducer(initialState, { type: 'hydrate', payload: withFamilies });
    expect(state.enums.technologyFamilies.map((row) => row.code)).toEqual(['database', 'directory']);
    state = reducer(state, { type: 'setEnum', id: 'technologyFamilies', items: state.enums.technologyFamilies.map((row) => (row.code === 'database' ? { ...row, deprecated: true } : row)) });
    expect(state.dirty.technologyFamilies).toBe(true);
  });

  it('detects a physical flag change as a modification', () => {
    let state = reducer(initialState, { type: 'hydrate', payload: settings });
    const kinds = state.enums.serverKinds.map((row) => ({ ...row, is_physical: true }));
    state = reducer(state, { type: 'setEnum', id: 'serverKinds', items: kinds });
    expect(state.dirty.serverKinds).toBe(true);
  });
});
