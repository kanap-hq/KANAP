import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import HardwareInfoPanel from './HardwareInfoPanel';

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const t = vi.hoisted(() => (key: string) => key);

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../../api', () => ({ default: { get, post } }));
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../../components/fields/DateEUField', () => ({ default: () => null }));

const wait = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

function renderPanel() {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <HardwareInfoPanel assetId="asset-1" />
    </ThemeProvider>,
  );
}

describe('HardwareInfoPanel', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    get.mockResolvedValue({ data: null });
    post.mockResolvedValue({ data: {} });
  });

  it('saves a pending change once when it leaves the page before the autosave', async () => {
    const view = renderPanel();
    await waitFor(() => expect(get).toHaveBeenCalledWith('/assets/asset-1/hardware-info'));
    const serial = screen.getByPlaceholderText('workspace.asset.hardware.serialNumberPlaceholder');
    await waitFor(() => expect(serial).toBeEnabled());
    fireEvent.change(serial, { target: { value: 'SN-42' } });
    view.unmount();
    await waitFor(() => expect(post).toHaveBeenCalledWith('/assets/asset-1/hardware-info', expect.objectContaining({ serial_number: 'SN-42' })));
    await wait(800);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('saves a pending change to the previous asset when the page moves to another asset', async () => {
    // The page keys the panel by asset id, so moving to another asset remounts it.
    const panel = (assetId: string) => (
      <ThemeProvider theme={createAppTheme('light')}>
        <HardwareInfoPanel key={assetId} assetId={assetId} />
      </ThemeProvider>
    );
    const view = render(panel('asset-1'));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/assets/asset-1/hardware-info'));
    const serial = screen.getByPlaceholderText('workspace.asset.hardware.serialNumberPlaceholder');
    await waitFor(() => expect(serial).toBeEnabled());
    fireEvent.change(serial, { target: { value: 'SN-42' } });
    view.rerender(panel('asset-2'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/assets/asset-1/hardware-info', expect.objectContaining({ serial_number: 'SN-42' })));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/assets/asset-2/hardware-info'));
    await wait(800);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('saves after the autosave delay while it stays on the page, and not again on leaving', async () => {
    const view = renderPanel();
    await waitFor(() => expect(get).toHaveBeenCalledWith('/assets/asset-1/hardware-info'));
    const serial = screen.getByPlaceholderText('workspace.asset.hardware.serialNumberPlaceholder');
    fireEvent.change(serial, { target: { value: 'SN-7' } });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1), { timeout: 2000 });
    await waitFor(() => expect(serial).toBeEnabled());
    view.unmount();
    await wait(50);
    expect(post).toHaveBeenCalledTimes(1);
  });
});
