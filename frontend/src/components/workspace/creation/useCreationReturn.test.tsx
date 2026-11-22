import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import useCreationReturn from './useCreationReturn';
import { recordLocation, resetNavigationTracker } from '../../navigation/NavigationTracker';

function returnAt(entry: string | { pathname: string; search?: string; state?: unknown }) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>
  );
  return renderHook(() => useCreationReturn('/list'), { wrapper }).result.current;
}

describe('useCreationReturn', () => {
  afterEach(() => resetNavigationTracker());

  it('goes back to the previous in-app address', () => {
    recordLocation('/knowledge?library=documents');
    expect(returnAt('/knowledge/new?library=documents')).toBe('/knowledge?library=documents');
  });

  it('skips this page before it rewrote its own query', () => {
    recordLocation('/knowledge/new');
    expect(returnAt('/knowledge/new?library=documents')).toBe('/list');
  });

  it('skips the new address of this page on another tab or without one', () => {
    recordLocation('/it/interfaces/new/flow');
    expect(returnAt('/it/interfaces/new/overview')).toBe('/list');
    recordLocation('/it/interfaces/new');
    expect(returnAt('/it/interfaces/new/overview')).toBe('/list');
    recordLocation('/ops/budget/new?nature=opex');
    expect(returnAt('/ops/budget/new')).toBe('/list');
  });

  it('skips the new address the record it created was written from', () => {
    recordLocation('/it/interfaces/new/flow');
    expect(returnAt('/it/interfaces/INT-9/flow')).toBe('/list');
  });

  it('keeps the new page of another record type', () => {
    recordLocation('/master-data/suppliers/new/overview');
    expect(returnAt('/master-data/contacts/new')).toBe('/master-data/suppliers/new/overview');
  });

  it('prefers the returnTo of the link state', () => {
    recordLocation('/elsewhere');
    expect(returnAt({ pathname: '/knowledge/new', state: { returnTo: '/home' } })).toBe('/home');
  });
});
