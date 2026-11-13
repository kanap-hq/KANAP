import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';

const stableT = vi.hoisted(() => (key: string) => key);
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [] } })) } }));
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ byField: { hostingType: [], serverProvider: [] }, labelFor: (_field: string, code?: string | null) => code || '' }),
}));

import LocationMetadataBar from './LocationMetadataBar';

function renderBar(props: { category: 'on_prem' | 'cloud'; onCityChange?: (next: string) => void; onRegionChange?: (next: string) => void }) {
  const noop = () => undefined;
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={new QueryClient()}>
        <LocationMetadataBar
          hostingType="on_prem"
          category={props.category}
          operatingCompanyId={null}
          operatingCompanyName={null}
          provider={null}
          region={null}
          countryIso={null}
          city={null}
          subLocationsCount={0}
          onHostingTypeChange={noop}
          onOperatingCompanyChange={noop}
          onProviderChange={noop}
          onRegionChange={props.onRegionChange ?? noop}
          onCountryChange={noop}
          onCityChange={props.onCityChange ?? noop}
        />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('LocationMetadataBar text fields', () => {
  it('saves the city once, when focus leaves it, and keeps the focus while it is typed', async () => {
    const user = userEvent.setup();
    const onCityChange = vi.fn();
    renderBar({ category: 'on_prem', onCityChange });
    await user.click(screen.getByTitle('workspace.location.meta.editCountryCity'));
    const city = await screen.findByLabelText('pages.locations.columns.city');
    await user.click(city);
    await user.keyboard('Lorient');
    expect(city).toHaveFocus();
    expect(city).toHaveValue('Lorient');
    expect(onCityChange).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(onCityChange).toHaveBeenCalledTimes(1);
    expect(onCityChange).toHaveBeenCalledWith('Lorient');
  });

  it('saves the region once, when focus leaves it', async () => {
    const user = userEvent.setup();
    const onRegionChange = vi.fn();
    renderBar({ category: 'cloud', onRegionChange });
    await user.click(screen.getByTitle('workspace.location.meta.editProviderRegion'));
    const region = await screen.findByLabelText('workspace.location.fields.region');
    await user.click(region);
    await user.keyboard('Bretagne');
    expect(region).toHaveFocus();
    expect(onRegionChange).not.toHaveBeenCalled();
    await user.tab();
    expect(onRegionChange).toHaveBeenCalledTimes(1);
    expect(onRegionChange).toHaveBeenCalledWith('Bretagne');
  });
});
