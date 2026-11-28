import { describe, expect, it } from 'vitest';
import { initialState, reducer, sendableRows } from './listsState';
import type { ItOpsSettings } from '../../../services/itOpsSettings';

const settings = {
  applicationCategories: [{ code: 'analytics', label: 'Analytics', deprecated: false }],
  accessMethods: [{ code: 'web', label: 'Web', deprecated: false }],
  serverKinds: [{ code: 'vm', label: 'Virtual machine', is_physical: false, deprecated: false }],
  connectionTypes: [], subnets: [], domains: [],
  lockedCodes: {}, protectedCodes: { serverKinds: ['vm'] },
} as unknown as ItOpsSettings;

const strip = (rows: any[]) => rows.map(({ localId: _localId, ...row }) => row);

describe('IT landscape settings lists', () => {
  it('keeps every list in its stored order, the three custom lists included', () => {
    const stored = {
      ...settings,
      technologyFamilies: [{ code: 'directory', label: 'Directory and identity' }, { code: 'database', label: 'Database' }],
      connectionTypes: [{ code: 'ssh', label: 'SSH', category: 'Remote' }, { code: 'http', label: 'HTTP', category: 'Application' }],
      subnets: [{ location_id: 'b', cidr: '10.2.0.0/24' }, { location_id: 'a', cidr: '10.1.0.0/24' }],
      domains: [{ code: 'zeta', label: 'Zeta', system: false }, { code: 'workgroup', label: 'Workgroup', system: true }],
    } as unknown as ItOpsSettings;
    const state = reducer(initialState, { type: 'hydrate', payload: stored });
    expect(state.enums.technologyFamilies.map((row) => row.code)).toEqual(['directory', 'database']);
    expect(state.connectionTypes.map((row) => row.code)).toEqual(['ssh', 'http']);
    expect(state.subnets.map((row) => row.cidr)).toEqual(['10.2.0.0/24', '10.1.0.0/24']);
    expect(state.domains.map((row) => row.code)).toEqual(['zeta', 'workgroup']);
  });

  it('assigns the generated code to a new row, keeps its row id and clears the change', () => {
    let state = reducer(initialState, { type: 'hydrate', payload: settings });
    const draft = [...state.enums.accessMethods, { code: '', label: 'Kiosk', deprecated: false, localId: 'new' }];
    state = reducer(state, { type: 'setList', id: 'accessMethods', items: draft });
    expect(state.dirty.accessMethods).toBe(true);
    const saved = { ...settings, accessMethods: [{ code: 'web', label: 'Web', deprecated: false }, { code: 'kiosk', label: 'Kiosk', deprecated: false }] } as ItOpsSettings;
    state = reducer(state, { type: 'saved', id: 'accessMethods', sent: draft, saved });
    expect(state.enums.accessMethods.map((row) => [row.code, row.label, row.localId])).toEqual([['web', 'Web', draft[0].localId], ['kiosk', 'Kiosk', 'new']]);
    expect(state.dirty.accessMethods).toBe(false);
    expect(state.baseline).toBe(saved);
  });

  it('keeps a rename made during the save, learns the generated code and stays changed', () => {
    let state = reducer(initialState, { type: 'hydrate', payload: settings });
    const draft = [...state.enums.accessMethods, { code: '', label: 'Kiosk', deprecated: false, localId: 'new' }];
    state = reducer(state, { type: 'setList', id: 'accessMethods', items: draft });
    // The person renames the row while the request is on its way.
    state = reducer(state, { type: 'setList', id: 'accessMethods', items: [draft[0], { ...draft[1], label: 'Kiosk terminal' }] });
    const saved = { ...settings, accessMethods: [{ code: 'web', label: 'Web', deprecated: false }, { code: 'kiosk', label: 'Kiosk', deprecated: false }] } as ItOpsSettings;
    state = reducer(state, { type: 'saved', id: 'accessMethods', sent: draft, saved });
    expect(state.enums.accessMethods[1]).toMatchObject({ code: 'kiosk', label: 'Kiosk terminal', localId: 'new' });
    expect(state.dirty.accessMethods).toBe(true);
  });

  it('matches a new row by the name it was sent with, wherever the server puts it', () => {
    let state = reducer(initialState, { type: 'hydrate', payload: settings });
    const draft = [...state.enums.serverKinds, { code: '', label: ' Rack server ', deprecated: false, localId: 'new' }];
    state = reducer(state, { type: 'setList', id: 'serverKinds', items: draft });
    // The server puts a protected value it adds back after the rows sent.
    const saved = { ...settings, serverKinds: [{ code: 'vm', label: 'Virtual machine' }, { code: 'rack_server', label: 'Rack server' }, { code: 'other', label: 'Other' }] } as unknown as ItOpsSettings;
    state = reducer(state, { type: 'saved', id: 'serverKinds', sent: draft, saved });
    expect(state.enums.serverKinds[1]).toMatchObject({ code: 'rack_server', label: 'Rack server', localId: 'new' });
  });

  it('does not touch the other lists when one list is saved', () => {
    let state = reducer(initialState, { type: 'hydrate', payload: settings });
    const categories = [...state.enums.applicationCategories, { code: '', label: 'Draft category', deprecated: false, localId: 'c' }];
    state = reducer(state, { type: 'setList', id: 'applicationCategories', items: categories });
    state = reducer(state, { type: 'saved', id: 'accessMethods', sent: state.enums.accessMethods, saved: settings });
    expect(state.enums.applicationCategories[1].label).toBe('Draft category');
    expect(state.dirty.applicationCategories).toBe(true);
  });

  it('never sends a blank added row, and shows the stored rows again after a refusal', () => {
    let state = reducer(initialState, { type: 'hydrate', payload: settings });
    const withBlank = [...state.enums.accessMethods, { code: '', label: '  ', deprecated: false, localId: 'blank' }];
    state = reducer(state, { type: 'setList', id: 'accessMethods', items: withBlank });
    expect(strip(sendableRows(state, 'accessMethods'))).toEqual(settings.accessMethods);
    state = reducer(state, { type: 'setList', id: 'accessMethods', items: [{ ...withBlank[0], label: 'Browser' }, withBlank[1]] });
    state = reducer(state, { type: 'revertList', id: 'accessMethods' });
    expect(strip(state.enums.accessMethods)).toEqual(settings.accessMethods);
    expect(state.dirty.accessMethods).toBe(false);
  });

  it('detects a physical flag change as a modification', () => {
    let state = reducer(initialState, { type: 'hydrate', payload: settings });
    state = reducer(state, { type: 'setList', id: 'serverKinds', items: state.enums.serverKinds.map((row) => ({ ...row, is_physical: true })) });
    expect(state.dirty.serverKinds).toBe(true);
  });
});
