import { describe, expect, it } from 'vitest';
import { isDataAccessLimited, isReservedInLimitedAccess } from './dataAccess';
import { canUseAnyOperation, canUseOperation } from '../pages/operations/operationAccess';

describe('data access of the signed-in person', () => {
  it('reads a missing or unscoped access as not limited', () => {
    expect(isDataAccessLimited(null)).toBe(false);
    expect(isDataAccessLimited(undefined)).toBe(false);
    expect(isDataAccessLimited({ available: true, mode: 'all', nodes: [], modules: [] })).toBe(false);
    expect(isDataAccessLimited({ available: true, mode: 'limited', nodes: [], modules: [] })).toBe(true);
  });

  it('keeps the reads of the reserved modules and takes their writes (spec §2.7)', () => {
    for (const resource of ['companies', 'departments', 'cost_centers', 'accounts', 'business_processes', 'analytics', 'budget_ops', 'users', 'ai_settings']) {
      expect(isReservedInLimitedAccess(resource, 'reader'), resource).toBe(false);
      expect(isReservedInLimitedAccess(resource, 'member'), resource).toBe(true);
      expect(isReservedInLimitedAccess(resource, 'admin'), resource).toBe(true);
    }
    // The agent screens are closed entirely.
    expect(isReservedInLimitedAccess('ai_agents', 'reader')).toBe(true);
    // The budget lines, contracts, tasks and suppliers follow the person's roles.
    for (const resource of ['budget', 'contracts', 'tasks', 'suppliers', 'contacts']) {
      expect(isReservedInLimitedAccess(resource, 'admin'), resource).toBe(false);
    }
  });

  it('closes every budget operation to a limited person', () => {
    const everything = () => true;
    expect(canUseAnyOperation(everything)).toBe(true);
    expect(canUseAnyOperation(everything, true)).toBe(false);
    for (const page of ['currency', 'columns', 'allocation-default', 'freeze', 'copy-budget', 'column-reset', 'master-data-freeze', 'metrics-copy']) {
      expect(canUseOperation(page, everything), page).toBe(true);
      expect(canUseOperation(page, everything, true), page).toBe(false);
    }
  });
});
