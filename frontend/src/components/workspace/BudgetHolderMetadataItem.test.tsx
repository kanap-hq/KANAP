import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
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
// IT-200 has a budget holder, IT-300 has none, IT-400 has another one.
vi.mock('../../hooks/useCostCenterTree', () => {
  const node = (id: string, code: string, name: string, owner: [string, string] | null) => ({
    id, code, name, kind: 'cost_center', parent_id: null, company_id: 'company-1', company_name: 'First company',
    owner_user_id: owner?.[0] ?? null, owner_name: owner?.[1] ?? null, status: 'enabled', disabled_at: null,
    sort_order: 0, depth: 0, path: name, path_ids: [id],
  });
  const nodes = [
    node('cc-200', 'IT-200', 'Applications', ['user-1', 'Ada Holder']),
    node('cc-300', 'IT-300', 'Service desk', null),
    node('cc-400', 'IT-400', 'Networks', ['user-2', 'Bea Keeper']),
  ];
  const tree = {
    ready: true, nodes, byId: new Map(nodes.map((n) => [n.id, n])), hasAny: true, isError: false,
    descendantIds: (id: string) => new Set([id]),
  };
  return { useCostCenterTree: () => tree };
});

import SpendMetadataBar from '../../pages/opex/workspace/SpendMetadataBar';
import CapexMetadataBar from '../../pages/capex/workspace/CapexMetadataBar';

const noop = () => undefined;

const BARS: Array<[string, (costCenterId: string | null) => React.ReactElement]> = [
  ['OPEX', (costCenterId) => (
    <SpendMetadataBar
      status="enabled"
      ownerItId={null}
      ownerBizId={null}
      costCenterId={costCenterId}
      onStatusChange={noop}
      onOwnerItChange={noop}
      onOwnerBizChange={noop}
    />
  )],
  ['CAPEX', (costCenterId) => (
    <CapexMetadataBar
      status="enabled"
      priority="medium"
      ownerItId={null}
      ownerBizId={null}
      costCenterId={costCenterId}
      onStatusChange={noop}
      onPriorityChange={noop}
      onOwnerItChange={noop}
      onOwnerBizChange={noop}
    />
  )],
];

const themed = (node: React.ReactElement) => <ThemeProvider theme={createAppTheme('light')}>{node}</ThemeProvider>;

describe.each(BARS)('%s metadata bar: budget holder', (_type, bar) => {
  it('is hidden when the line has no cost center', () => {
    render(themed(bar(null)));
    expect(screen.queryByTestId('budget-holder')).toBeNull();
    expect(screen.queryByText('shared.budgetHolder')).toBeNull();
  });

  it('is hidden when the cost center has no budget holder', () => {
    render(themed(bar('cc-300')));
    expect(screen.queryByTestId('budget-holder')).toBeNull();
  });

  it('shows the name after the business owner, with where it comes from', async () => {
    render(themed(bar('cc-200')));
    const item = screen.getByTestId('budget-holder');
    expect(within(item).getByText('shared.budgetHolder')).toBeTruthy();
    expect(within(item).getByText('Ada Holder')).toBeTruthy();
    expect(within(item).getByText('AH')).toBeTruthy();
    // After the business owner picker.
    const businessOwner = screen.getByText(/businessOwnerMissing$/);
    expect(businessOwner.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.mouseOver(item);
    expect((await screen.findByRole('tooltip')).textContent).toBe('From the cost center IT-200 · Applications.');
  });

  it('is read only: no button, and a click opens nothing', () => {
    render(themed(bar('cc-200')));
    const item = screen.getByTestId('budget-holder');
    expect(within(item).queryByRole('button')).toBeNull();
    fireEvent.click(within(item).getByText('Ada Holder'));
    expect(screen.queryByRole('presentation')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it("follows the line's cost center when it changes", () => {
    const { rerender } = render(themed(bar('cc-200')));
    rerender(themed(bar('cc-400')));
    expect(within(screen.getByTestId('budget-holder')).getByText('Bea Keeper')).toBeTruthy();
    rerender(themed(bar('cc-300')));
    expect(screen.queryByTestId('budget-holder')).toBeNull();
  });
});
