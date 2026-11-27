import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ENTITY_TYPE_CONFIG, useRecentlyViewed } from './useRecentlyViewed';
import { forgetRecentlyViewed } from '../../../lib/recentViews';

vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'user-1' } }) }));
vi.mock('../../../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'tenant-1' }) }));
const KEY = 'kanap-recent-views:tenant-1:user-1';
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), key: (index: number) => Array.from(values.keys())[index] ?? null, get length() { return values.size; } });
});

describe('recent budget lines', () => {
  it('keeps one entry after a type change, with its BL reference and new type', () => {
    const { result } = renderHook(useRecentlyViewed);
    act(() => result.current.addToRecent('spend_item', 'line-1', 'Software', 'BL-12'));
    act(() => result.current.addToRecent('capex_item', 'line-1', 'Software updated', 'BL-12'));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({ id: 'line-1', type: 'capex_item', ref: 'BL-12', label: 'Software updated' });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(1);
  });

  it('deduplicates stored budget entries by id and retains other entity types', () => {
    localStorage.setItem(KEY, JSON.stringify([
      { type: 'capex_item', id: 'same', label: 'New', ref: 'BL-12', viewedAt: 3 },
      { type: 'spend_item', id: 'same', label: 'Old', ref: 'OPX-12', viewedAt: 2 },
      { type: 'project', id: 'same', label: 'Project', ref: 'PRJ-4', viewedAt: 1 },
    ]));
    const { result } = renderHook(useRecentlyViewed);
    expect(result.current.items.map((item) => item.ref)).toEqual(['BL-12', 'PRJ-4']);
  });
});

describe('a deleted record', () => {
  it('leaves the open list at once', () => {
    const { result } = renderHook(useRecentlyViewed);
    act(() => result.current.addToRecent('contract', 'gone', 'Deleted contract'));
    act(() => result.current.addToRecent('asset', 'kept', 'Server'));
    act(() => forgetRecentlyViewed(['gone']));
    expect(result.current.items.map((item) => item.id)).toEqual(['kept']);
    expect(JSON.parse(localStorage.getItem(KEY)!).map((item: { id: string }) => item.id)).toEqual(['kept']);
  });
});

describe('reference data', () => {
  it('keeps suppliers, contacts and departments with their reference, opened by it', () => {
    const { result } = renderHook(useRecentlyViewed);
    act(() => result.current.addToRecent('supplier', 'sup-1', 'Fromagerie Bleue', 'SUP-12'));
    act(() => result.current.addToRecent('contact', 'ctc-1', 'Ana Lopez', 'CTCT-3'));
    act(() => result.current.addToRecent('department', 'dep-1', 'Finance', 'DEPT-7'));
    expect(result.current.items.map((item) => `${item.type}:${item.ref}`)).toEqual(['department:DEPT-7', 'contact:CTCT-3', 'supplier:SUP-12']);
    expect(ENTITY_TYPE_CONFIG.supplier).toMatchObject({ resource: 'suppliers', labelKey: 'dashboard.tiles.entityTypes.supplier' });
    expect(ENTITY_TYPE_CONFIG.supplier.route('sup-1')).toBe('/master-data/suppliers/sup-1');
    expect(ENTITY_TYPE_CONFIG.supplier.route('sup-1', 'SUP-12')).toBe('/master-data/suppliers/SUP-12');
    expect(ENTITY_TYPE_CONFIG.contact).toMatchObject({ resource: 'contacts', labelKey: 'dashboard.tiles.entityTypes.contact' });
    expect(ENTITY_TYPE_CONFIG.contact.route('ctc-1')).toBe('/master-data/contacts/ctc-1');
    expect(ENTITY_TYPE_CONFIG.contact.route('ctc-1', 'CTCT-3')).toBe('/master-data/contacts/CTCT-3');
    expect(ENTITY_TYPE_CONFIG.department).toMatchObject({ resource: 'departments', labelKey: 'dashboard.tiles.entityTypes.department' });
    // The company, department, supplier and contact pages open by their reference; an item kept without one opens by its uuid.
    expect(ENTITY_TYPE_CONFIG.department.route('dep-1', 'DEPT-7')).toBe('/master-data/departments/DEPT-7');
    expect(ENTITY_TYPE_CONFIG.department.route('dep-1')).toBe('/master-data/departments/dep-1');
    expect(ENTITY_TYPE_CONFIG.company.route('co-1', 'COMP-5')).toBe('/master-data/companies/COMP-5');
    expect(ENTITY_TYPE_CONFIG.company.route('co-1')).toBe('/master-data/companies/co-1');
  });

  it('opens a contract by its reference, by its uuid when kept without one', () => {
    expect(ENTITY_TYPE_CONFIG.contract.route('ct-1', 'CTR-4')).toBe('/ops/contracts/CTR-4');
    expect(ENTITY_TYPE_CONFIG.contract.route('ct-1')).toBe('/ops/contracts/ct-1');
  });

  it('opens a project, a request and a task by their reference, by their uuid when kept without one', () => {
    expect(ENTITY_TYPE_CONFIG.project.route('prj-1', 'PRJ-4')).toBe('/portfolio/projects/PRJ-4');
    expect(ENTITY_TYPE_CONFIG.project.route('prj-1')).toBe('/portfolio/projects/prj-1');
    expect(ENTITY_TYPE_CONFIG.request.route('req-1', 'REQ-2')).toBe('/portfolio/requests/REQ-2');
    expect(ENTITY_TYPE_CONFIG.request.route('req-1')).toBe('/portfolio/requests/req-1');
    expect(ENTITY_TYPE_CONFIG.task.route('task-1', 'T-9')).toBe('/portfolio/tasks/T-9');
    expect(ENTITY_TYPE_CONFIG.task.route('task-1')).toBe('/portfolio/tasks/task-1');
  });
});
