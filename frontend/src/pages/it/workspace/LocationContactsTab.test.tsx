import React from 'react';
import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import '../../../i18n';
import { createAppTheme } from '../../../config/ThemeContext';

vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

import { ExternalRow, InternalRow, LinkRowComponent } from './LocationContactsTab';

// A row's fields follow the stored row in the render that receives it (as the sub-location rows
// do, #624). An effect would apply it only after the commit, leaving a window where what is typed
// is overwritten. The probe reads the inputs at layout time, before any passive effect has run.
function Probe({ children, onCommit }: { children: React.ReactNode; onCommit: (values: string[]) => void }) {
  const ref = React.useRef<HTMLTableSectionElement | null>(null);
  React.useLayoutEffect(() => {
    onCommit(Array.from(ref.current?.querySelectorAll('input') ?? []).map((input) => input.value));
  });
  return (
    <table>
      <tbody ref={ref}>{children}</tbody>
    </table>
  );
}

function renderRow(make: (row: any) => React.ReactNode, first: any, next: any) {
  const seen: string[][] = [];
  const ui = (row: any) => (
    <ThemeProvider theme={createAppTheme('light')}>
      <Probe onCommit={(values) => seen.push(values)}>{make(row)}</Probe>
    </ThemeProvider>
  );
  const view = render(ui(first));
  view.rerender(ui(next));
  return seen[seen.length - 1];
}

describe('LocationContactsTab rows', () => {
  const noop = () => undefined;

  it('an internal contact row shows the stored role in the render that receives it', () => {
    const row = { id: 'i1', user_id: 'u1', role: 'Owner', user: { id: 'u1', first_name: 'Ann', email: 'a@x' } };
    const values = renderRow(
      (r) => <InternalRow row={r} canManage onRoleChange={noop} onRemove={noop} />,
      row,
      { ...row, role: 'Backup' },
    );
    expect(values).toEqual(['Backup']);
  });

  it('an external contact row shows the stored role in the render that receives it', () => {
    const row = { id: 'e1', contact_id: 'c1', role: 'Vendor', contact: { id: 'c1', first_name: 'Bob' } };
    const values = renderRow(
      (r) => <ExternalRow row={r} canManage onRoleChange={noop} onRemove={noop} />,
      row,
      { ...row, role: 'Support' },
    );
    expect(values).toEqual(['Support']);
  });

  it('a link row shows the stored description and address in the render that receives them', () => {
    const row = { id: 'l1', description: 'Plan', url: 'https://a.example' };
    const values = renderRow(
      (r) => <LinkRowComponent row={r} canManage onSave={noop} onRemove={noop} />,
      row,
      { ...row, description: 'Floor plan', url: 'https://b.example' },
    );
    expect(values).toEqual(['Floor plan', 'https://b.example']);
  });
});
