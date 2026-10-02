import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('react-i18next', () => {
  const t = (key: string, opts?: { code?: string; name?: string }) => (
    key === 'shared.budgetHolderSource' ? `From the cost center ${opts?.code} · ${opts?.name}.` : key
  );
  const translation = { t, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
// The owner pickers load users from the API; this file only checks the budget holder next to them.
vi.mock('./MetadataUserPicker', () => ({
  default: (p: { placeholder: string }) => <button type="button">{p.placeholder}</button>,
}));
// IT-200 has a budget holder, IT-300 has none, IT-400 has another one. The real hooks read the tree
// through this service, so a test can tell whether the tree was loaded at all.
const treeCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../services/costCenters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/costCenters')>();
  const node = (id: string, code: string, name: string, owner: [string, string] | null) => ({
    id, code, name, kind: 'cost_center' as const, parent_id: null, company_id: 'company-1', company_name: 'First company',
    owner_user_id: owner?.[0] ?? null, owner_name: owner?.[1] ?? null, status: 'enabled' as const, depth: 0, path: name, path_ids: [id],
  });
  const nodes = [
    node('cc-200', 'IT-200', 'Applications', ['user-1', 'Ada Holder']),
    node('cc-300', 'IT-300', 'Service desk', null),
    node('cc-400', 'IT-400', 'Networks', ['user-2', 'Bea Keeper']),
  ];
  return {
    ...actual,
    getCostCenterTree: async () => {
      treeCalls.count += 1;
      return nodes;
    },
  };
});

import SpendMetadataBar from '../../pages/opex/workspace/SpendMetadataBar';
import type { CostCenterRef } from '../../services/costCenters';
import CapexMetadataBar from '../../pages/capex/workspace/CapexMetadataBar';

const noop = () => undefined;

type Known = CostCenterRef | null;

const BARS: Array<[string, (costCenterId: string | null, known?: Known) => React.ReactElement]> = [
  ['OPEX', (costCenterId, known = null) => (
    <SpendMetadataBar
      status="enabled"
      ownerItId={null}
      ownerBizId={null}
      costCenterId={costCenterId}
      costCenter={known}
      onStatusChange={noop}
      onOwnerItChange={noop}
      onOwnerBizChange={noop}
    />
  )],
  ['CAPEX', (costCenterId, known = null) => (
    <CapexMetadataBar
      status="enabled"
      priority="medium"
      ownerItId={null}
      ownerBizId={null}
      costCenterId={costCenterId}
      costCenter={known}
      onStatusChange={noop}
      onPriorityChange={noop}
      onOwnerItChange={noop}
      onOwnerBizChange={noop}
    />
  )],
];

// The line's cost center as its detail names it (`references.cost_center`).
const DETAIL_REF: CostCenterRef = {
  id: 'cc-200', code: 'IT-200', name: 'Applications', kind: 'cost_center', status: 'enabled',
  company_id: 'company-1', company_name: 'First company', owner_user_id: 'user-1', owner_name: 'Ada Holder',
};

let queryClient: QueryClient;
beforeEach(() => {
  treeCalls.count = 0;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
const themed = (node: React.ReactElement) => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider theme={createAppTheme('light')}>{node}</ThemeProvider>
  </QueryClientProvider>
);

describe.each(BARS)('%s metadata bar: budget holder', (_type, bar) => {
  it('is hidden when the line has no cost center, and loads no tree', async () => {
    render(themed(bar(null)));
    expect(screen.queryByTestId('budget-holder')).toBeNull();
    expect(screen.queryByText('shared.budgetHolder')).toBeNull();
    await Promise.resolve();
    expect(treeCalls.count).toBe(0);
  });

  it('is hidden when the cost center has no budget holder', async () => {
    render(themed(bar('cc-300')));
    await waitFor(() => expect(treeCalls.count).toBe(1));
    expect(screen.queryByTestId('budget-holder')).toBeNull();
  });

  it('shows the name after the business owner, with where it comes from', async () => {
    render(themed(bar('cc-200')));
    const item = await screen.findByTestId('budget-holder');
    expect(within(item).getByText('shared.budgetHolder')).toBeTruthy();
    expect(within(item).getByText('Ada Holder')).toBeTruthy();
    expect(within(item).getByText('AH')).toBeTruthy();
    // After the business owner picker.
    const businessOwner = screen.getByText(/businessOwnerMissing$/);
    expect(businessOwner.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.mouseOver(item);
    expect((await screen.findByRole('tooltip')).textContent).toBe('From the cost center IT-200 · Applications.');
  });

  it("reads the line's detail without loading the tree", async () => {
    render(themed(bar('cc-200', DETAIL_REF)));
    // At once: no request to wait for.
    expect(within(screen.getByTestId('budget-holder')).getByText('Ada Holder')).toBeTruthy();
    await Promise.resolve();
    expect(treeCalls.count).toBe(0);
  });

  it('is read only: no button, and a click opens nothing', async () => {
    render(themed(bar('cc-200', DETAIL_REF)));
    const item = screen.getByTestId('budget-holder');
    expect(within(item).queryByRole('button')).toBeNull();
    fireEvent.click(within(item).getByText('Ada Holder'));
    expect(screen.queryByRole('presentation')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it("follows the line's cost center when it changes, from the tree once the detail names another one", async () => {
    const { rerender } = render(themed(bar('cc-200', DETAIL_REF)));
    expect(within(screen.getByTestId('budget-holder')).getByText('Ada Holder')).toBeTruthy();
    expect(treeCalls.count).toBe(0);
    // A new pick, saved before the detail is read again: the detail still names IT-200.
    rerender(themed(bar('cc-400', DETAIL_REF)));
    await waitFor(() => expect(within(screen.getByTestId('budget-holder')).getByText('Bea Keeper')).toBeTruthy());
    expect(treeCalls.count).toBe(1);
    rerender(themed(bar('cc-300', DETAIL_REF)));
    expect(screen.queryByTestId('budget-holder')).toBeNull();
  });
});
