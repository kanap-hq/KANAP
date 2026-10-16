import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import '../../../i18n';
import { createAppTheme } from '../../../config/ThemeContext';

vi.mock('../../../hooks/useApplicationClassificationCatalog', () => ({
  default: () => ({ data: { businessCriticalityLevels: [], dataClasses: [] } }),
}));
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ settings: { connectionTypes: [] }, labelFor: (_: string, code: string) => code }),
}));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../../../components/EntityKnowledgePanel', () => ({ default: () => null }));
vi.mock('../../../components/MarkdownEditor', () => ({ default: () => null }));
vi.mock('./ConnectionEndpointPicker', () => ({ default: () => null }));
vi.mock('./ConnectionLinkInterfacesDialog', () => ({ default: () => null }));
vi.mock('./ConnectionProtocolsTable', () => ({ default: () => null }));

import ConnectionOverviewTab from './ConnectionOverviewTab';

const binding = (id: string, ref: string, name: string, environment: string) => ({
  id,
  binding_id: `b-${id}`,
  interface_id: `if-${ref}`,
  interface_reference: ref,
  interface_name: name,
  environment,
  leg_type: 'direct',
  source_endpoint: null,
  target_endpoint: null,
  pattern: 'direct',
  binding_status: 'enabled',
  interface_criticality: 'high',
  interface_data_class: 'internal',
  interface_contains_pii: false,
});

describe('ConnectionOverviewTab risk derivation', () => {
  it('lists each interface once, with its environments on the line, so the count and lines agree', () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <ConnectionOverviewTab
            connectionId="c1"
            topology="server_to_server"
            initialDescription=""
            canManage={false}
            source={{ asset_id: null, entity_code: null }}
            destination={{ asset_id: null, entity_code: null }}
            multiServerIds={[]}
            assetMap={{}}
            protocols={[]}
            riskMode="derived"
            linkedInterfaces={[
              binding('1', 'INT-2', 'Billing feed', 'prod'),
              binding('2', 'INT-1', 'HR sync', 'prod'),
              binding('3', 'INT-1', 'HR sync', 'qa'),
            ]}
            linkedInterfacesLoading={false}
            linkedInterfacesError={null}
            derivedInterfaceCount={2}
            onEndpointChange={vi.fn()}
            onMultiServerChange={vi.fn()}
            onProtocolsChange={vi.fn()}
            onLinkedInterfacesChanged={vi.fn()}
          />
        </MemoryRouter>
      </ThemeProvider>,
    );
    const heading = screen.getByRole('heading', { name: 'Risk derivation (2 interfaces)' });
    const table = heading.parentElement!.parentElement!.querySelector('table')!;
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    const hr = rows.find((row) => row.textContent?.includes('INT-1'))!;
    expect(hr.textContent).toContain('PROD, QA');
  });
});
