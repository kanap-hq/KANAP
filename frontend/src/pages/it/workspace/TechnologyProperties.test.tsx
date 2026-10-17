import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import { TechnologyProperties, type TechnologyDetail } from './TechnologyOverviewTab';

const stableT = (key: string, options?: Record<string, unknown>) => (options?.label ? `${key}:${options.label}` : key);
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [], has_more: false } })), post: vi.fn() } }));
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({
    settings: null,
    byField: {
      technologyFamily: [{ code: 'directory', label: 'Directory and identity' }],
      adminZone: [{ code: 'tier_0', label: 'Tier 0' }, { code: 'tier_1', label: 'Tier 1' }, { code: 'old', label: 'Old zone', deprecated: true }],
    },
    labelFor: (_field: string, code: string) => code ?? '',
  }),
}));
vi.mock('../../../components/fields/TeamMemberMultiSelect', () => ({ default: () => <div /> }));

const TECHNOLOGY: TechnologyDetail = {
  id: 'tech-1', reference: 'TEC-1', name: 'Active Directory', editor: 'Microsoft', family: 'directory', admin_zone: 'tier_0',
  mode: 'installed', lifecycle: 'active', description: null, notes: null, cpe_products: [], replaced_by_id: null, replaced_by: null, versions: [], owners: [],
};

function renderProperties(technology: TechnologyDetail, canManage = true) {
  const onPatch = vi.fn();
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TechnologyProperties technology={technology} canManage={canManage} onPatch={onPatch} onOwnersChange={vi.fn()} onError={vi.fn()} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return onPatch;
}

const zoneField = () => screen.getByRole('combobox', { name: 'workspace.technology.fields.adminZone' });

describe('TechnologyProperties: administration zone', () => {
  it('shows the zone and saves another one, retired zones not offered', () => {
    const onPatch = renderProperties(TECHNOLOGY);
    expect(zoneField()).toHaveTextContent('Tier 0');
    fireEvent.mouseDown(zoneField());
    const options = within(screen.getByRole('listbox')).getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['workspace.technology.placeholders.noAdminZone', 'Tier 0', 'Tier 1']);
    fireEvent.click(screen.getByRole('option', { name: 'Tier 1' }));
    expect(onPatch).toHaveBeenCalledWith({ admin_zone: 'tier_1' });
  });

  it('clears the zone with the empty choice', () => {
    const onPatch = renderProperties(TECHNOLOGY);
    fireEvent.mouseDown(zoneField());
    fireEvent.click(screen.getByRole('option', { name: 'workspace.technology.placeholders.noAdminZone' }));
    expect(onPatch).toHaveBeenCalledWith({ admin_zone: null });
  });

  it('keeps a retired or unknown zone the technology is in', () => {
    renderProperties({ ...TECHNOLOGY, admin_zone: 'old' });
    expect(zoneField()).toHaveTextContent('Old zone');
  });

  it('says when no zone is set, and is read only without the right', () => {
    renderProperties({ ...TECHNOLOGY, admin_zone: null }, false);
    expect(zoneField()).toHaveTextContent('workspace.technology.placeholders.noAdminZone');
    expect(zoneField()).toHaveAttribute('aria-disabled', 'true');
  });
});
