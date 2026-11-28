import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import { catalogDefaults } from '../../utils/itOpsSettingsLocalization';
import EnumEditor, { nameColumn, physicalColumn, retiredColumn, type EnumItem } from './EnumEditor';
import { catalogEditorIssues, catalogListIssues } from './catalogValidation';

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

const segments = [
  { code: 'guest', label: 'Guest', deprecated: false },
  { code: 'wifi', label: 'Wi-Fi', deprecated: false },
];

const tc = (key: string) => i18n.t(`common:${key}`);

function renderEditor(props: Partial<React.ComponentProps<typeof EnumEditor<any>>> = {}) {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  const view = render(
    <MemoryRouter>
      <ThemeProvider theme={createAppTheme('light')}>
        <EnumEditor items={items} onChange={onChange} onCommit={onCommit} usageList="applicationCategories" {...props} />
      </ThemeProvider>
    </MemoryRouter>,
  );
  return { onChange, onCommit, view };
}

const lastRows = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.calls[onChange.mock.calls.length - 1][0];
const lastHow = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.calls[onChange.mock.calls.length - 1][1];

describe('catalogListIssues', () => {
  it('flags empty, duplicate, code-colliding and comma names, and keeps the names of server-managed rows taken', () => {
    const issues = catalogListIssues([
      { code: 'a', label: 'Same' }, { code: 'b', label: ' same ' }, { code: 'c', label: '' },
      { code: 'high', label: 'High' }, { code: 'd', label: 'high' }, { code: 'e', label: 'Web, mobile' }, { code: 'locked', label: '' },
    ], { forbidComma: true, skipCodes: new Set(['locked']) });
    expect([...issues.entries()].sort()).toEqual([[0, 'nameExists'], [1, 'nameExists'], [2, 'nameRequired'], [3, 'nameExists'], [4, 'nameExists'], [5, 'noComma']]);
    expect(catalogListIssues([{ code: 'high', label: 'Élevée' }, { code: 'custom', label: 'high' }]).get(1)).toBe('nameMatchesCode');
    expect(catalogListIssues([{ code: 'high', label: 'high' }]).size).toBe(0);
    // A built-in status still owns its name: a value named the same is flagged, and so is the status.
    const locked = catalogListIssues([{ code: 'active', label: 'Active' }, { code: '', label: 'active' }], { skipCodes: new Set(['active']) });
    expect([...locked.entries()].sort()).toEqual([[0, 'nameExists'], [1, 'nameExists']]);
  });

  it('flags two values shown with the same name in the language of the person', () => {
    const rows = [{ code: 'guest', label: 'Guest' }, { code: '', label: 'Invités' }, { code: 'lan', label: 'LAN' }];
    const shown = (row: { code?: string; label?: string }) => (row.code === 'guest' ? 'Invités' : row.label ?? '');
    expect([...catalogEditorIssues(rows, shown).entries()].sort()).toEqual([[0, 'nameExists'], [1, 'nameExists']]);
    expect(catalogEditorIssues(rows, (row) => row.label ?? '').size).toBe(0);
  });
});

describe('EnumEditor', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(async () => { await act(async () => { await i18n.changeLanguage('en'); }); });

  it('shows names without any code field and flags a duplicate name on both rows', () => {
    renderEditor();
    expect(screen.queryByText('Code')).not.toBeInTheDocument();
    const names = screen.getAllByRole('textbox', { name: 'Name' });
    expect(names).toHaveLength(3);
    fireEvent.change(names[1], { target: { value: 'analytics' } });
    expect(screen.getAllByText('This name already exists')).toHaveLength(2);
  });

  it('marks Name as required, shows the example and no helper under an empty name', () => {
    renderEditor({ items: [{ code: '', label: '', deprecated: false }], namePlaceholder: 'e.g., Productivity' });
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveTextContent('*');
    expect(screen.queryByText('A name is required')).not.toBeInTheDocument();
    const name = screen.getByRole('textbox', { name: 'Name' });
    expect(name).toBeRequired();
    expect(name).toHaveAttribute('placeholder', 'e.g., Productivity');
  });

  it('shows a shipped value by its name in the language of the person, and sends it back with its base name', async () => {
    await act(async () => { await i18n.changeLanguage('fr'); });
    const { onChange } = renderEditor({ items: segments, defaults: catalogDefaults('networkSegments'), usageList: 'networkSegments' });
    const names = screen.getAllByRole('textbox', { name: tc('enumEditor.name') });
    expect(names.map((field) => (field as HTMLInputElement).value)).toEqual(['Invités', 'Wi-Fi']);
    fireEvent.click(screen.getByRole('checkbox', { name: `${tc('enumEditor.noLongerOffered')} Wi-Fi` }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(lastRows(onChange)[0]).toMatchObject({ code: 'guest', label: 'Guest' });
    expect(lastRows(onChange)[0].translations).toBeUndefined();
    expect(lastHow(onChange)).toBe('choose');
  });

  it('makes a retyped name the base name and drops only the translation typed in the language of the person', async () => {
    await act(async () => { await i18n.changeLanguage('fr'); });
    const row = { code: 'guest', label: 'Guest', deprecated: false, translations: { fr: { label: 'Visiteurs' }, de: { label: 'Besucher' } } };
    const { onChange } = renderEditor({ items: [row], defaults: catalogDefaults('networkSegments') });
    const name = screen.getByRole('textbox', { name: tc('enumEditor.name') });
    expect(name).toHaveValue('Visiteurs');
    fireEvent.change(name, { target: { value: 'Réseau invités' } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(lastRows(onChange)[0]).toMatchObject({ code: 'guest', label: 'Réseau invités', translations: { de: { label: 'Besucher' } } });
    expect(lastRows(onChange)[0].translations.fr).toBeUndefined();
    expect(lastHow(onChange)).toBe('type');
  });

  it('gives a value back its shipped base name when its shipped French name is typed again', async () => {
    await act(async () => { await i18n.changeLanguage('fr'); });
    const row = { code: 'virtual_machine', label: 'VM maison', deprecated: false, translations: { de: { label: 'VM' } } };
    const { onChange } = renderEditor({ items: [row], defaults: catalogDefaults('serverKinds'), usageList: 'serverKinds' });
    const name = screen.getByRole('textbox', { name: tc('enumEditor.name') });
    expect(name).toHaveValue('VM maison');
    fireEvent.change(name, { target: { value: 'Machine virtuelle' } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(lastRows(onChange)[0]).toMatchObject({ code: 'virtual_machine', label: 'Virtual Machine', translations: { de: { label: 'VM' } } });
    expect(name).toHaveValue('Machine virtuelle');
  });

  it('keeps the shipped base name when the English name shown is typed again', async () => {
    const row = { code: 'virtual_machine', label: 'Virtual Machine', deprecated: false };
    const { onChange } = renderEditor({ items: [row], defaults: catalogDefaults('serverKinds'), usageList: 'serverKinds' });
    const name = screen.getByRole('textbox', { name: tc('enumEditor.name') });
    expect(name).toHaveValue('Virtual machine');
    fireEvent.change(name, { target: { value: 'Virtual machin' } });
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    fireEvent.change(name, { target: { value: 'Virtual machine' } });
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    expect(lastRows(onChange)[0].label).toBe('Virtual Machine');
    expect(name).toHaveValue('Virtual machine');
  });

  it('sends the row as stored when a letter is typed and erased', async () => {
    await act(async () => { await i18n.changeLanguage('fr'); });
    const row = { code: 'virtual_machine', label: 'Virtual Machine', deprecated: false };
    const { onChange } = renderEditor({ items: [row], defaults: catalogDefaults('serverKinds'), usageList: 'serverKinds' });
    const name = screen.getByRole('textbox', { name: tc('enumEditor.name') });
    fireEvent.change(name, { target: { value: 'Machine virtuelleX' } });
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(lastRows(onChange)[0].label).toBe('Machine virtuelleX');
    fireEvent.change(name, { target: { value: 'Machine virtuelle' } });
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    const { localId: _localId, ...sent } = lastRows(onChange)[0];
    expect(sent).toEqual(row);
  });

  it('flags an added value named like the shipped translation of another one', async () => {
    await act(async () => { await i18n.changeLanguage('fr'); });
    renderEditor({ items: [...segments, { code: '', label: 'Invités', deprecated: false }], defaults: catalogDefaults('networkSegments') });
    expect(screen.getAllByText(tc('enumEditor.nameExists'))).toHaveLength(2);
  });

  it('previews the shipped translation in the dialog and stores a typed one, which darkens the icon', async () => {
    const { onChange, view } = renderEditor({ items: segments, defaults: catalogDefaults('networkSegments') });
    const icon = screen.getByRole('button', { name: 'Translate Guest' });
    const plain = getComputedStyle(icon).color;
    fireEvent.click(icon);
    const french = await screen.findByRole('textbox', { name: 'Name Français' });
    expect(french).toHaveAttribute('placeholder', 'Shown: Invités');
    fireEvent.change(french, { target: { value: 'Visiteurs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(lastRows(onChange)[0]).toMatchObject({ code: 'guest', label: 'Guest', translations: { fr: { label: 'Visiteurs' } } });
    expect(lastHow(onChange)).toBe('choose');
    view.rerender(
      <MemoryRouter>
        <ThemeProvider theme={createAppTheme('light')}>
          <EnumEditor items={lastRows(onChange)} onChange={onChange} defaults={catalogDefaults('networkSegments')} />
        </ThemeProvider>
      </MemoryRouter>,
    );
    expect(getComputedStyle(screen.getByRole('button', { name: 'Translate Guest' })).color).not.toBe(plain);
    expect(getComputedStyle(screen.getByRole('button', { name: 'Translate Wi-Fi' })).color).toBe(plain);
  });

  it('adds a row at the bottom with the cursor in its name, and commits when a field is left', async () => {
    const { onChange, onCommit } = renderEditor({ newRow: () => ({ is_physical: true }) as Partial<EnumItem> });
    fireEvent.click(screen.getByRole('button', { name: 'Add an item' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(lastRows(onChange).map((row: any) => row.code)).toEqual(['analytics', 'security', 'lan', '']);
    expect(lastRows(onChange)[3]).toMatchObject({ label: '', deprecated: false, is_physical: true });
    const names = screen.getAllByRole('textbox', { name: 'Name' });
    await waitFor(() => expect(names[3]).toHaveFocus());
    fireEvent.blur(names[3]);
    expect(onCommit).toHaveBeenCalled();
  });

  it('removes an unused value directly and offers to stop offering a used one', async () => {
    serviceMocks.fetchCatalogUsage.mockResolvedValueOnce({ total: 0, usage: [] });
    const { onChange } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Delete LAN' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(lastRows(onChange).map((row: any) => row.code)).toEqual(['analytics', 'security']);
    expect(lastHow(onChange)).toBe('choose');
    expect(serviceMocks.fetchCatalogUsage).toHaveBeenCalledWith('applicationCategories', { code: 'lan' });

    serviceMocks.fetchCatalogUsage.mockResolvedValueOnce({ total: 3, usage: [{ record: 'applications', count: 3, listPath: '/it/applications?filters=x' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Delete Analytics' }));
    expect(await screen.findByText('Value still in use')).toBeInTheDocument();
    expect(screen.getByText('3 applications')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute('href', '/it/applications?filters=x');
    fireEvent.click(screen.getByRole('button', { name: 'Stop offering' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    expect(lastRows(onChange).find((row: any) => row.code === 'analytics').deprecated).toBe(true);
    expect(lastRows(onChange)).toHaveLength(2);
  });

  it('shows a built-in value as text and keeps protected values without a delete action', () => {
    renderEditor({ lockedCodes: ['analytics'], protectedCodes: ['lan'] });
    expect(screen.getAllByRole('textbox', { name: 'Name' })).toHaveLength(2);
    expect(screen.getByText('Analytics')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Stop offering Analytics' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Translate Analytics' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Delete / })).toHaveLength(1);
    expect(screen.getAllByText('Built-in')).toHaveLength(2);
  });

  it('declares extra columns, and saves a ticked box at once', async () => {
    const t = i18n.getFixedT('en', 'common');
    const { onChange } = renderEditor({
      items: [{ code: 'vm', label: 'Virtual machine', is_physical: false, deprecated: false }],
      columns: [nameColumn(t, '50%'), physicalColumn(t), retiredColumn(t)],
      protectedCodes: ['vm'],
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Physical Virtual machine' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(lastRows(onChange)[0].is_physical).toBe(true);
    expect(lastHow(onChange)).toBe('choose');
    expect(screen.queryByRole('button', { name: /^Delete / })).not.toBeInTheDocument();
  });

  it('locks every field and hides add, delete and translate for a reader', () => {
    renderEditor({ readOnly: true });
    const fields = [...screen.getAllByRole('textbox'), ...screen.getAllByRole('checkbox')];
    expect(fields.length).toBeGreaterThan(0);
    fields.forEach((field) => expect(field).toBeDisabled());
    expect(screen.queryByRole('button', { name: /^Delete / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Translate/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add an item' })).not.toBeInTheDocument();
    expect(screen.queryByText('Built-in')).not.toBeInTheDocument();
  });
});
