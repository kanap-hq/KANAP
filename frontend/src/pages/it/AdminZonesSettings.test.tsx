import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import { AdminZonesEditor, autosaveBlocked, initialState, reducer } from './ItOperationsSettingsPage';
import DomainTrustsDialog from './components/DomainTrustsDialog';
import type { DomainOption, ItOpsSettings } from '../../services/itOpsSettings';

const stableT = (key: string, options?: Record<string, unknown>) => (options?.name ? `${key}:${options.name}` : key);
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(async () => ({ data: { total: 0, usage: [] } })), patch: vi.fn(), post: vi.fn() } }));

function wrap(children: React.ReactNode) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <KanapDialogProvider>{children}</KanapDialogProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const settings = {
  adminZones: [{ code: 'tier_0', label: 'Tier 0', deprecated: false, admin_group: 'Domain admins', privilege_level: 'Tier 0' }],
  operatingSystems: [], connectionTypes: [], subnets: [], domains: [], lockedCodes: {}, protectedCodes: {},
} as unknown as ItOpsSettings;

describe('Administration zones settings', () => {
  it('hydrates the zones and marks an attribute change as a modification', () => {
    let state = reducer(initialState, { type: 'hydrate', payload: settings });
    expect(state.enums.adminZones.map((row: any) => [row.code, row.admin_group])).toEqual([['tier_0', 'Domain admins']]);
    state = reducer(state, { type: 'setEnum', id: 'adminZones', items: state.enums.adminZones.map((row) => ({ ...row, secrets_location: 'Vault A' })) });
    expect(state.dirty.adminZones).toBe(true);
    state = reducer(state, { type: 'setEnum', id: 'adminZones', items: state.enums.adminZones.map(({ secrets_location: _s, ...row }: any) => row) });
    expect(state.dirty.adminZones).toBe(false);
  });

  it('does not resend rows the server refused until they are edited again', () => {
    let state = reducer(initialState, { type: 'hydrate', payload: settings });
    const tooLong = state.enums.adminZones.map((row) => ({ ...row, description: 'x'.repeat(2001) }));
    state = reducer(state, { type: 'setEnum', id: 'adminZones', items: tooLong });
    expect(autosaveBlocked(state, 'adminZones')).toBe(false);
    state = reducer(state, { type: 'rejected', id: 'adminZones', sent: tooLong.map(({ localId: _l, ...row }) => row) });
    expect(state.dirty.adminZones).toBe(true);
    expect(autosaveBlocked(state, 'adminZones')).toBe(true);
    expect(autosaveBlocked(state, 'domains')).toBe(false);
    const fixed = state.enums.adminZones.map((row) => ({ ...row, description: 'Identity core' }));
    state = reducer(state, { type: 'setEnum', id: 'adminZones', items: fixed });
    expect(autosaveBlocked(state, 'adminZones')).toBe(false);
  });

  it('limits each field to what the server accepts', () => {
    wrap(<AdminZonesEditor items={settings.adminZones} onChange={vi.fn()} />);
    const limit = (name: string) => screen.getByRole('textbox', { name }).getAttribute('maxlength');
    expect(limit('pages.settings.columns.adminGroup Tier 0')).toBe('200');
    expect(limit('pages.settings.columns.privilegeLevel Tier 0')).toBe('100');
    expect(limit('pages.settings.columns.secretsLocation Tier 0')).toBe('200');
    expect(limit('pages.settings.columns.description Tier 0')).toBe('2000');
  });

  it('edits a zone in place and says when the list is empty', async () => {
    const onChange = vi.fn();
    const { unmount } = wrap(<AdminZonesEditor items={settings.adminZones} onChange={onChange} />);
    expect(screen.getByDisplayValue('Domain admins')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'pages.settings.columns.secretsLocation Tier 0' }), { target: { value: 'Vault A' } });
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][0][0]).toMatchObject({ code: 'tier_0', secrets_location: 'Vault A', admin_group: 'Domain admins' });
    unmount();
    wrap(<AdminZonesEditor items={[]} onChange={vi.fn()} />);
    expect(screen.getByText('pages.settings.empty.adminZones')).toBeInTheDocument();
  });
});

describe('Domain trusts dialog', () => {
  const domains: DomainOption[] = [
    { code: 'workgroup', label: 'Workgroup', dns_suffix: '', system: true },
    { code: 'corp', label: 'Corp', dns_suffix: 'corp.example.com', trusts: [{ domain: 'lab', direction: 'two_way' }] },
    { code: 'lab', label: 'Lab', dns_suffix: 'lab.example.com' },
    { code: 'partner', label: 'Partner', dns_suffix: 'partner.example.com', trusts: [{ domain: 'corp', direction: 'outgoing' }] },
    { code: '', label: 'Unsaved', dns_suffix: '' },
  ];

  it('changes a direction, adds a trusted domain among the other saved ones, and saves', () => {
    const onSave = vi.fn();
    wrap(<DomainTrustsDialog domain={domains[1]} domains={domains} onClose={vi.fn()} onSave={onSave} />);
    expect(screen.getByText('Lab')).toBeInTheDocument();
    expect(screen.getByText('pages.settings.trusts.directionsHint')).toBeInTheDocument();
    // Partner trusts Corp: shown read only on Corp as an incoming trust.
    expect(screen.getByText('pages.settings.trusts.declaredElsewhere')).toBeInTheDocument();
    expect(screen.getByText('Partner (pages.settings.trusts.directions.incoming)')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'pages.settings.trusts.direction Lab' }));
    fireEvent.click(screen.getByRole('option', { name: 'pages.settings.trusts.directions.outgoing' }));
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'pages.settings.trusts.add' }));
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((option) => option.textContent)).toEqual(['Partner']);
    fireEvent.click(screen.getByRole('option', { name: 'Partner' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.save' }));
    expect(onSave).toHaveBeenCalledWith([{ domain: 'lab', direction: 'outgoing' }, { domain: 'partner', direction: 'two_way' }]);
  });

  it('saves no trusts as absent after removing the last one', () => {
    const onSave = vi.fn();
    wrap(<DomainTrustsDialog domain={domains[1]} domains={domains} onClose={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'common:enumEditor.remove Lab' }));
    expect(screen.getByText('pages.settings.trusts.empty')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.save' }));
    expect(onSave).toHaveBeenCalledWith(undefined);
  });
});
