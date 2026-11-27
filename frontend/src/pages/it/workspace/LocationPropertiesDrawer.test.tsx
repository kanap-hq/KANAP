import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';

// Rule P7 (lot K2c of 26.12.1): a retired hosting type or cloud provider is offered only to the
// location that holds it.

const stableT = vi.hoisted(() => (key: string, options?: { label?: string }) => (options?.label ? `${key}:${options.label}` : key));
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../../components/fields/CompanySelect', () => ({ default: () => null }));
vi.mock('../../../i18n/countries', () => ({ useCountryOptions: () => [], filterCountryOptions: () => [] }));
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({
    byField: {
      hostingType: [{ code: 'public_cloud', label: 'Public cloud' }, { code: 'old_cloud', label: 'Old cloud', deprecated: true }],
      serverProvider: [{ code: 'aws', label: 'AWS' }, { code: 'old_provider', label: 'Old provider', deprecated: true }],
    },
  }),
}));

import LocationPropertiesDrawer from './LocationPropertiesDrawer';

const noop = () => undefined;

function renderDrawer(hostingType: string, provider: string) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <LocationPropertiesDrawer
        data={{ hosting_type: hostingType, operating_company_id: null, provider, region: null, country_iso: null, city: null }}
        category="cloud"
        onHostingTypeChange={noop}
        onOperatingCompanyChange={noop}
        onProviderChange={noop}
        onRegionChange={noop}
        onCountryChange={noop}
        onCityChange={noop}
      />
    </ThemeProvider>,
  );
}

async function optionsOf(index: number) {
  fireEvent.mouseDown(screen.getAllByRole('combobox')[index]);
  const names = within(await screen.findByRole('listbox')).getAllByRole('option').map((node) => node.textContent);
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  return names;
}

describe('LocationPropertiesDrawer catalog values (rule P7)', () => {
  afterEach(cleanup);

  it('does not offer a retired hosting type or provider to a location that does not hold it', async () => {
    renderDrawer('public_cloud', 'aws');
    expect(await optionsOf(0)).toEqual(['Public cloud']);
    expect(await optionsOf(1)).toEqual(['—', 'AWS']);
  });

  it('offers them to the location that holds them', async () => {
    renderDrawer('old_cloud', 'old_provider');
    expect(await optionsOf(0)).toEqual(['Public cloud', 'Old cloud (common:enumEditor.retiredSuffix)']);
    expect(await optionsOf(1)).toEqual(['—', 'AWS', 'Old provider (common:enumEditor.retiredSuffix)']);
  });
});
