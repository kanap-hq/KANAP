import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import SupportInfoPanel from './SupportInfoPanel';

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const t = vi.hoisted(() => (key: string) => key);

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../../api', () => ({ default: { get, post } }));
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../../hooks/useLookupPicker', () => ({
  useLookupPicker: () => ({ autocomplete: {}, options: [], selected: [], remember: () => undefined, label: () => '', loading: false }),
}));
vi.mock('../../../components/fields/ContactSelect', () => ({ default: () => null }));
vi.mock('../../../components/fields/DateEUField', () => ({ default: () => null }));

const wait = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

function renderPanel() {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <SupportInfoPanel assetId="asset-1" />
    </ThemeProvider>,
  );
}

describe('SupportInfoPanel', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    get.mockImplementation(async (url: string) => (url.endsWith('/support-contacts') ? { data: [] } : { data: null }));
    post.mockResolvedValue({ data: {} });
  });

  it('saves a pending change once when it leaves the page before the autosave', async () => {
    const view = renderPanel();
    await waitFor(() => expect(get).toHaveBeenCalledWith('/assets/asset-1/support-contacts'));
    const tier = screen.getByPlaceholderText('workspace.asset.support.supportTierPlaceholder');
    await waitFor(() => expect(tier).toBeEnabled());
    fireEvent.change(tier, { target: { value: 'Gold' } });
    view.unmount();
    await waitFor(() => expect(post).toHaveBeenCalledWith('/assets/asset-1/support-info', expect.objectContaining({ support_tier: 'Gold' })));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/assets/asset-1/support-contacts/bulk-replace', { contacts: [] }));
    await wait(800);
    expect(post.mock.calls.filter(([url]) => url === '/assets/asset-1/support-info')).toHaveLength(1);
  });

  it('sends nothing on leaving when nothing changed', async () => {
    const view = renderPanel();
    await waitFor(() => expect(get).toHaveBeenCalledWith('/assets/asset-1/support-contacts'));
    view.unmount();
    await wait(50);
    expect(post).not.toHaveBeenCalled();
  });
});
