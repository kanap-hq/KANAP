import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import EnumEditor, { AssetKindEditor, HostingTypeEditor } from './EnumEditor';
import { catalogListIssues } from './catalogValidation';

const serviceMocks = vi.hoisted(() => ({ fetchCatalogUsage: vi.fn() }));
vi.mock('../../services/itOpsSettings', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../services/itOpsSettings')>(),
  fetchCatalogUsage: serviceMocks.fetchCatalogUsage,
}));

const items = [
  { code: 'analytics', label: 'Analytics', deprecated: false },
  { code: 'security', label: 'Security', deprecated: false },
  { code: 'lan', label: 'LAN', deprecated: false },
];

function renderEditor(props: Partial<React.ComponentProps<typeof EnumEditor>> = {}) {
  const onChange = vi.fn();
  render(
    <MemoryRouter>
      <ThemeProvider theme={createAppTheme('light')}>
        <EnumEditor title="Categories" description="" items={items} onChange={onChange} usageList="applicationCategories" hideAddButton {...props} />
      </ThemeProvider>
    </MemoryRouter>,
  );
  return { onChange };
}

describe('catalogListIssues', () => {
  it('flags empty, duplicate, code-colliding and comma names, and skips server-managed rows', () => {
    const issues = catalogListIssues([
      { code: 'a', label: 'Same' }, { code: 'b', label: ' same ' }, { code: 'c', label: '' },
      { code: 'high', label: 'High' }, { code: 'd', label: 'high' }, { code: 'e', label: 'Web, mobile' }, { code: 'locked', label: '' },
    ], { forbidComma: true, skipCodes: new Set(['locked']) });
    expect([...issues.entries()].sort()).toEqual([[0, 'nameExists'], [1, 'nameExists'], [2, 'nameRequired'], [3, 'nameExists'], [4, 'nameExists'], [5, 'noComma']]);
    expect(catalogListIssues([{ code: 'high', label: 'Élevée' }, { code: 'custom', label: 'high' }]).get(1)).toBe('nameMatchesCode');
    expect(catalogListIssues([{ code: 'high', label: 'high' }]).size).toBe(0);
  });
});

describe('EnumEditor', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows names without any code field and flags a duplicate name', () => {
    renderEditor();
    expect(screen.queryByPlaceholderText('internal_code')).not.toBeInTheDocument();
    expect(screen.queryByText('Code')).not.toBeInTheDocument();
    const names = screen.getAllByRole('textbox', { name: 'Name' });
    expect(names).toHaveLength(3);
    fireEvent.change(names[1], { target: { value: 'analytics' } });
    expect(screen.getAllByText('This name already exists')).toHaveLength(2);
  });

  it('shows the catalog name example and no shared tier example', () => {
    renderEditor({ namePlaceholder: 'e.g., Productivity' });
    expect(screen.getAllByRole('textbox', { name: 'Name' })[0]).toHaveAttribute('placeholder', 'e.g., Productivity');
    expect(screen.queryByPlaceholderText('e.g., Tier 1')).not.toBeInTheDocument();
    cleanup();
    render(
      <MemoryRouter>
        <ThemeProvider theme={createAppTheme('light')}>
          <HostingTypeEditor items={[{ code: 'colocation', label: 'Colocation' }]} onChange={() => undefined} namePlaceholder="e.g., Colocation" hideAddButton />
        </ThemeProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('placeholder', 'e.g., Colocation');
    expect(screen.queryByPlaceholderText('e.g., Tier 1')).not.toBeInTheDocument();
  });

  it('marks Name as required and does not show a helper under an empty name', () => {
    renderEditor({ items: [{ code: '', label: '', deprecated: false }] });
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveTextContent('*');
    expect(screen.queryByText('A name is required')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeRequired();
  });

  it('removes an unused value directly and offers "no longer offered" for a used one', async () => {
    serviceMocks.fetchCatalogUsage.mockResolvedValueOnce({ total: 0, usage: [] });
    const { onChange } = renderEditor();
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[2]);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[0][0].map((row: any) => row.code)).toEqual(['analytics', 'security']);
    expect(serviceMocks.fetchCatalogUsage).toHaveBeenCalledWith('applicationCategories', { code: 'lan' });

    serviceMocks.fetchCatalogUsage.mockResolvedValueOnce({ total: 3, usage: [{ record: 'applications', count: 3, listPath: '/it/applications?filters=x' }] });
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    expect(await screen.findByText('Value still in use')).toBeInTheDocument();
    expect(screen.getByText('3 applications')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute('href', '/it/applications?filters=x');
    fireEvent.click(screen.getByRole('button', { name: 'No longer offered' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    const retired = onChange.mock.calls[1][0].find((row: any) => row.code === 'analytics');
    expect(retired.deprecated).toBe(true);
    expect(onChange.mock.calls[1][0]).toHaveLength(2);
  });

  it('keeps locked rows read-only and protected rows without a remove action', () => {
    renderEditor({ lockedCodes: ['analytics'], protectedCodes: ['lan'] });
    expect(screen.getAllByRole('textbox', { name: 'Name' })[0]).toBeDisabled();
    expect(screen.getAllByRole('textbox', { name: 'Name' })[2]).toBeEnabled();
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
    expect(screen.getAllByText('Built-in')).toHaveLength(2);
  });

  it('opens the translations dialog for a saved row and stores the result on the row', async () => {
    const { onChange } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Translate Analytics' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Name Français' }), { target: { value: 'Analytique' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[0][0][0]).toMatchObject({ code: 'analytics', label: 'Analytics', translations: { fr: { label: 'Analytique' } } });
  });

  it('locks every field and hides add, remove and translate when read-only', () => {
    renderEditor({ readOnly: true, hideAddButton: false });
    const fields = [...screen.getAllByRole('textbox'), ...screen.getAllByRole('checkbox')];
    expect(fields.length).toBeGreaterThan(0);
    fields.forEach((field) => expect(field).toBeDisabled());
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Translate/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add value' })).not.toBeInTheDocument();
    expect(screen.queryByText('Built-in')).not.toBeInTheDocument();
  });

  it('derived editors expose their extra columns and pass the guards through', () => {
    const onChange = vi.fn();
    render(
      <MemoryRouter>
        <ThemeProvider theme={createAppTheme('light')}>
          <AssetKindEditor items={[{ code: 'vm', label: 'Virtual machine', is_physical: false }]} onChange={onChange} protectedCodes={['vm']} hideAddButton />
        </ThemeProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByText('Code')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Physical Virtual machine' }));
    expect(onChange.mock.calls[0][0][0].is_physical).toBe(true);
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });
});
