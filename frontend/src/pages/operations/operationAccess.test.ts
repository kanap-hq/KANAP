import { describe, expect, it } from 'vitest';
import { canUseAnyOperation, canUseOperation } from './operationAccess';

const RANK: Record<string, number> = { reader: 1, member: 3, admin: 4 };
const grants = (granted: Record<string, string>) => (resource: string, level: 'reader' | 'admin') =>
  (RANK[granted[resource]] ?? 0) >= RANK[level];

// The shipped roles (backend/src/tenants/tenants.service.ts).
const BUDGET_READER = grants({ budget: 'reader', companies: 'reader', departments: 'reader' });
const BUDGET_MEMBER = grants({ budget: 'member', budget_ops: 'reader', companies: 'reader', departments: 'member' });
const BUDGET_ADMIN = grants({ budget: 'admin', budget_ops: 'admin' });

describe('who opens the budget administration pages', () => {
  it('opens the budget columns and the default allocation to a budget member, read-only, and no operation', () => {
    expect(canUseOperation('columns', BUDGET_MEMBER)).toBe(true);
    expect(canUseOperation('allocation-default', BUDGET_MEMBER)).toBe(true);
    for (const page of ['column-reset', 'copy-budget', 'currency', 'freeze', 'master-data-freeze', 'metrics-copy']) {
      expect(canUseOperation(page, BUDGET_MEMBER), page).toBe(false);
    }
    expect(canUseAnyOperation(BUDGET_MEMBER)).toBe(true);
  });

  it('opens no administration page to a budget reader, who reads the budget lines and not their settings', () => {
    for (const page of ['currency', 'columns', 'allocation-default', 'freeze', 'copy-budget', 'column-reset', 'master-data-freeze', 'metrics-copy']) {
      expect(canUseOperation(page, BUDGET_READER), page).toBe(false);
    }
    expect(canUseAnyOperation(BUDGET_READER)).toBe(false);
  });

  it('opens every page to a budget administrator', () => {
    for (const page of ['currency', 'columns', 'allocation-default', 'freeze', 'copy-budget', 'column-reset', 'master-data-freeze', 'metrics-copy']) {
      expect(canUseOperation(page, BUDGET_ADMIN), page).toBe(true);
    }
  });

  it('opens nothing to a person whose data access is limited, whatever the role', () => {
    for (const hasLevel of [BUDGET_READER, BUDGET_MEMBER, BUDGET_ADMIN]) {
      expect(canUseAnyOperation(hasLevel, true)).toBe(false);
      for (const page of ['columns', 'allocation-default', 'column-reset']) expect(canUseOperation(page, hasLevel, true), page).toBe(false);
    }
  });

  it('opens nothing without a budget administration right', () => {
    const itLandscapeReader = grants({ applications: 'reader', infrastructure: 'reader' });
    expect(canUseAnyOperation(itLandscapeReader)).toBe(false);
    expect(canUseOperation('columns', itLandscapeReader)).toBe(false);
  });
});
