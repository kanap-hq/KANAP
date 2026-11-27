import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import { createAppTheme } from '../../../config/ThemeContext';
import ConnectionPropertiesDrawer from './ConnectionPropertiesDrawer';
import ConnectionMetadataBar from './ConnectionMetadataBar';
import ConnectionHopEquipmentPicker from './ConnectionHopEquipmentPicker';

// Rule P7 (lot K2c of 26.12.1): a value retired from a catalog is offered only to the connection,
// or the hop, that already holds it.

vi.mock('../../../utils/applicationClassification', () => ({ classificationText: (text: string) => text }));
vi.mock('../../../api', () => ({ default: { get: vi.fn().mockResolvedValue({ data: { items: [] } }) } }));
vi.mock('../../../hooks/useApplicationClassificationCatalog', () => ({ default: () => ({ data: { businessCriticalityLevels: [], dataClasses: [] } }) }));
vi.mock('../../../hooks/useItOpsEnumOptions', () => {
  const lifecycleStatus = [{ code: 'active', label: 'Active' }, { code: 'legacy', label: 'Legacy', deprecated: true }];
  const settings = {
    connectionTypes: [{ code: 'https', label: 'HTTPS' }, { code: 'ftp', label: 'FTP', deprecated: true }],
    entities: [{ code: 'hq', label: 'Headquarters' }, { code: 'old_dc', label: 'Old data centre', deprecated: true }],
  };
  return { default: () => ({ byField: { lifecycleStatus }, settings, labelFor: (_field: string, code: string) => code }) };
});

const noop = () => undefined;
const theme = createAppTheme('light');

function renderDrawer(lifecycle: string) {
  return render(
    <ThemeProvider theme={theme}>
      <ConnectionPropertiesDrawer
        lifecycle={lifecycle}
        topology="server_to_server"
        topologyDisabled={false}
        riskMode="manual"
        criticality={null}
        dataClass=""
        containsPii={false}
        effectiveCriticality=""
        effectiveDataClass=""
        effectiveContainsPii={false}
        derivedInterfaceCount={0}
        derivedAvailable={false}
        createdAt={null}
        updatedAt={null}
        onLifecycleChange={noop}
        onTopologyChange={noop}
        onRiskModeChange={noop}
        onCriticalityChange={noop}
        onDataClassChange={noop}
        onContainsPiiChange={noop}
      />
    </ThemeProvider>,
  );
}

function renderBar(lifecycle: string, protocolCodes: string[]) {
  return render(
    <ThemeProvider theme={theme}>
      <ConnectionMetadataBar
        lifecycle={lifecycle}
        topology="server_to_server"
        criticality=""
        effectiveCriticality=""
        riskMode="manual"
        derivedInterfaceCount={0}
        protocolCodes={protocolCodes}
        protocolLabels={undefined}
        endpointsLabel="A -> B"
        onLifecycleChange={noop}
        onTopologyChange={noop}
        onCriticalityChange={noop}
        onProtocolCodesChange={noop}
      />
    </ThemeProvider>,
  );
}

const optionNames = (role: 'option' | 'menuitem') => screen.getAllByRole(role).map((node) => node.textContent?.trim());

const retired = (label: string) => `${label} (${i18n.t('common:enumEditor.retiredSuffix')})`;

describe('connection catalog values (rule P7)', () => {
  beforeEach(async () => { await i18n.changeLanguage('en'); });
  afterEach(cleanup);

  it('the drawer offers a retired lifecycle only to the connection that holds it', () => {
    renderDrawer('legacy');
    fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
    expect(optionNames('option')).toContain(retired('Legacy'));
    cleanup();
    renderDrawer('active');
    fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
    expect(optionNames('option')).toEqual(['Active']);
  });

  it('the header offers a retired lifecycle and a retired protocol only to the connection that holds them', () => {
    renderBar('legacy', ['ftp']);
    fireEvent.click(screen.getByText('legacy'));
    expect(optionNames('menuitem')).toContain(retired('Legacy'));
    cleanup();
    renderBar('active', ['https']);
    fireEvent.click(screen.getByText('active'));
    expect(optionNames('menuitem')).toEqual(['Active']);
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0], { key: 'Escape' });
    cleanup();
    renderBar('active', ['https']);
    fireEvent.click(screen.getByText('HTTPS'));
    const protocols = screen.getAllByRole('menuitem').map((node) => node.textContent);
    expect(protocols).toEqual(['HTTPS']);
    cleanup();
    renderBar('active', ['ftp', 'https']);
    // The header and the list mark the retired protocol the connection holds.
    fireEvent.click(screen.getByText(`${retired('FTP')}, HTTPS`));
    expect(screen.getAllByRole('menuitem').map((node) => node.textContent)).toEqual(['HTTPS', retired('FTP')]);
  });

  it('the equipment of a hop offers a retired entity only to the hop that holds it', () => {
    render(<ThemeProvider theme={theme}><ConnectionHopEquipmentPicker value={{ asset_id: null, entity_code: 'hq' }} onChange={noop} /></ThemeProvider>);
    const select = screen.getAllByRole('combobox').find((node) => node.textContent?.includes('Headquarters'))!;
    fireEvent.mouseDown(select);
    const list = within(screen.getByRole('listbox'));
    expect(list.queryByText('Old data centre')).toBeNull();
    cleanup();
    render(<ThemeProvider theme={theme}><ConnectionHopEquipmentPicker value={{ asset_id: null, entity_code: 'old_dc' }} onChange={noop} /></ThemeProvider>);
    fireEvent.mouseDown(screen.getAllByRole('combobox').find((node) => node.textContent?.includes(retired('Old data centre')))!);
    expect(within(screen.getByRole('listbox')).getByText(retired('Old data centre'))).toBeInTheDocument();
  });
});
