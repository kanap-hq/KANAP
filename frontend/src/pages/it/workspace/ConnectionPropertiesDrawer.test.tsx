import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import ConnectionPropertiesDrawer from './ConnectionPropertiesDrawer';

// The settings and the classification catalog arrive after the first render (a new connection
// shows its draft at once): the selects wait for the option of their value instead of warning.

const options = vi.hoisted(() => ({ loaded: false }));
const stableT = (key: string) => key;

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: stableT }) }));
vi.mock('../../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../../utils/applicationClassification', () => ({ classificationText: (text: string) => text }));
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({
    byField: options.loaded ? { lifecycleStatus: [{ code: 'active', label: 'Active', deprecated: false }] } : {},
    labelFor: (_field: string, code: string) => code,
  }),
}));
vi.mock('../../../hooks/useApplicationClassificationCatalog', () => ({
  default: () => ({
    data: options.loaded
      ? {
        businessCriticalityLevels: [{ code: 'high', label: 'High' }],
        dataClasses: [{ code: 'internal', label: 'Internal' }],
      }
      : undefined,
  }),
}));

function renderDrawer() {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
    <ConnectionPropertiesDrawer
      lifecycle="active"
      topology="server_to_server"
      topologyDisabled={false}
      riskMode="manual"
      criticality="high"
      dataClass="internal"
      containsPii={false}
      effectiveCriticality=""
      effectiveDataClass=""
      effectiveContainsPii={false}
      derivedInterfaceCount={0}
      derivedAvailable={false}
      createdAt={null}
      updatedAt={null}
      disabled
      onLifecycleChange={() => undefined}
      onTopologyChange={() => undefined}
      onRiskModeChange={() => undefined}
      onCriticalityChange={() => undefined}
      onDataClassChange={() => undefined}
      onContainsPiiChange={() => undefined}
    />
    </ThemeProvider>,
  );
}

describe('ConnectionPropertiesDrawer', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    options.loaded = false;
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    cleanup();
    warn.mockRestore();
  });

  it('renders before its options arrive without an out-of-range value, then shows the values', () => {
    const view = renderDrawer();
    const outOfRange = () => warn.mock.calls.filter((call: unknown[]) => String(call[0]).includes('out-of-range'));
    expect(outOfRange()).toEqual([]);
    options.loaded = true;
    view.rerender(<></>);
    renderDrawer();
    expect(outOfRange()).toEqual([]);
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('High')).toBeTruthy();
    expect(screen.getByText('Internal')).toBeTruthy();
  });
});
