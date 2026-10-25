import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import { createAppTheme } from '../../../config/ThemeContext';
import ConnectionHopEquipmentPicker from './ConnectionHopEquipmentPicker';
import type { ServerOption } from '../../../components/fields/serverOptionRender';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('../../../api', () => ({ default: { get: apiGet } }));
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ settings: { entities: [] }, labelFor: (_field: string, code: string) => code }),
}));

const OUTSIDE: ServerOption = {
  id: 'asset-99',
  name: 'EDGE-FW-99',
  asset_reference: 'AST-99',
  environment: 'prod',
  kind: 'firewall',
  provider: 'on_prem',
  is_cluster: false,
};

describe('ConnectionHopEquipmentPicker', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    apiGet.mockReset();
    apiGet.mockResolvedValue({ data: { items: [] } });
  });

  it('shows the equipment the leg carries at once, without reading it', async () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <ConnectionHopEquipmentPicker
          value={{ asset_id: OUTSIDE.id, entity_code: null }}
          initialAsset={OUTSIDE}
          onChange={vi.fn()}
        />
      </ThemeProvider>,
    );
    expect(await screen.findByDisplayValue('AST-99 · EDGE-FW-99')).toBeInTheDocument();
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(apiGet.mock.calls.some(([url]) => url === `/assets/${OUTSIDE.id}`)).toBe(false);
  });
});
