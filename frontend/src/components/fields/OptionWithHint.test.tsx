import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Autocomplete, TextField } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

const apiGet = vi.hoisted(() => vi.fn());
const stableT = vi.hoisted(() => (key: string) => key);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));
vi.mock('../../api', () => ({ default: { get: apiGet } }));
vi.mock('../../hooks/useApplicationClassificationCatalog', () => ({
  default: () => ({ data: { businessCriticalityLevels: [{ code: 'high', label: 'High' }] } }),
}));
vi.mock('../../hooks/useItOpsSettings', () => ({
  useItOpsSettings: () => ({ data: { lifecycleStates: [{ code: 'active', label: 'Active' }] } }),
  default: () => ({ data: { lifecycleStates: [{ code: 'active', label: 'Active' }] } }),
}));

import ApplicationSelect from './ApplicationSelect';
import MultiRoleSelect from './MultiRoleSelect';
import ServerSelect from './ServerSelect';
import SupplierSelect from './SupplierSelect';
import OptionWithHint, { OPTION_HINT_DELAY_MS } from './OptionWithHint';

function renderField(node: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>{node}</ThemeProvider>
    </QueryClientProvider>,
  );
}

async function openList() {
  const input = await screen.findByRole('combobox');
  // ApplicationSelect stays disabled while its list loads.
  await waitFor(() => expect(input).not.toBeDisabled());
  act(() => { input.focus(); });
  fireEvent.mouseDown(input);
  return screen.findAllByRole('option');
}

/** One visible line with the name; the hint only as the accessible description and the delayed tooltip. */
async function expectOneLineWithHint(option: HTMLElement, line: string, hint: string) {
  expect(option.firstChild?.textContent).toBe(line);
  expect(option).toHaveAccessibleName(line);
  expect(option).toHaveAccessibleDescription(hint);
  expect(screen.getByText(hint)).not.toBeVisible();
  fireEvent.mouseOver(option);
  expect(await screen.findByRole('tooltip', {}, { timeout: 2000 })).toHaveTextContent(hint);
}

describe('picker options: one line, the description in a delayed tooltip', () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  it('ApplicationSelect: lifecycle and criticality move to the tooltip', async () => {
    apiGet.mockResolvedValue({ data: { items: [{ id: 'a1', name: 'Billing', lifecycle: 'active', criticality: 'high' }] } });
    renderField(<ApplicationSelect value={null} onChange={() => undefined} />);
    const [option] = await openList();
    await expectOneLineWithHint(option, 'Billing', 'Active · High');
  });

  it('ServerSelect: environment, kind and provider move to the tooltip; a cluster carries its mark and its members', async () => {
    apiGet.mockResolvedValue({
      data: { items: [{ id: 's1', name: 'web-01', environment: 'prod', kind: 'vm', provider: 'azure', is_cluster: true, member_names: ['PAR-SQL-01', 'PAR-SQL-02'] }] },
    });
    renderField(<ServerSelect value={null} onChange={() => undefined} />);
    await openList();
    await waitFor(() => expect(screen.getByRole('option').firstChild?.textContent).toBe('web-01PAR-SQL-01, PAR-SQL-02'));
    const option = screen.getByRole('option');
    expect(within(option).getByRole('img', { name: 'pages.assets.columns.cluster' })).toBeTruthy();
    expect(option).toHaveAccessibleDescription('PROD · vm · azure');
  });

  it('MultiRoleSelect: the role description moves to the tooltip', async () => {
    apiGet.mockResolvedValue({ data: { items: [{ id: 'r1', role_name: 'Editor', role_description: 'Edits budget lines' }] } });
    renderField(<MultiRoleSelect value={[]} onChange={() => undefined} />);
    const [option] = await openList();
    await expectOneLineWithHint(option, 'Editor', 'Edits budget lines');
  });

  it('SupplierSelect: the ERP id and the disabled status stay on the name line, with no tooltip', async () => {
    apiGet.mockResolvedValue({
      data: {
        items: [
          { id: 'sup1', name: 'Acme', erp_supplier_id: 'F-001', status: 'disabled' },
          { id: 'sup2', name: 'Globex', erp_supplier_id: null, status: 'enabled' },
        ],
        has_more: false,
      },
    });
    renderField(<SupplierSelect value={null} onChange={() => undefined} />);
    const [acme, globex] = await openList();
    expect(acme.firstChild?.textContent).toBe('AcmeF-001 · common:statuses.disabled');
    expect(acme.querySelectorAll('div')).toHaveLength(0);
    expect(acme).not.toHaveAttribute('aria-describedby');
    expect(globex.firstChild?.textContent).toBe('Globex');
    fireEvent.mouseOver(acme);
    await act(async () => { await new Promise((r) => setTimeout(r, 900)); });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('OptionWithHint (asset sub-location): waits before showing the hint, and shows none for an option without one', async () => {
    const options = [
      { id: 'l1', name: 'Room A', description: 'Second floor, east wing' },
      { id: 'l2', name: 'Room B', description: '  ' },
    ];
    renderField(
      <Autocomplete
        options={options}
        getOptionLabel={(o) => o.name}
        renderOption={(props, option) => (
          <OptionWithHint key={option.id} optionProps={props} label={option.name} hint={option.description} />
        )}
        renderInput={(params) => <TextField {...params} variant="standard" />}
      />,
    );
    const [roomA, roomB] = await openList();
    expect(roomB).not.toHaveAttribute('aria-describedby');
    fireEvent.mouseOver(roomA);
    await act(async () => { await new Promise((r) => setTimeout(r, OPTION_HINT_DELAY_MS / 2)); });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(await screen.findByRole('tooltip', {}, { timeout: 2000 })).toHaveTextContent('Second floor, east wing');
  });
});
