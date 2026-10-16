import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';

// One stable `t` (a new one per render would loop the effects).
const stableT = vi.hoisted(() => (key: string) => key);
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('../../../components/fields/BusinessProcessCategoryMultiSelect', () => ({ default: () => null }));
vi.mock('../../../components/fields/UserSelect', () => ({ default: () => null }));

import api from '../../../api';
import BusinessProcessCreateEditor, { type BusinessProcessCreateEditorHandle } from './BusinessProcessCreateEditor';
import BusinessProcessOverviewEditor, { type BusinessProcessOverviewEditorHandle } from './BusinessProcessOverviewEditor';

const mocked = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
};

const PROCESS = {
  id: 'bp-1',
  name: 'Order to cash',
  description: null,
  notes: null,
  status: 'enabled',
  disabled_at: '2099-12-31T12:00:00.000Z',
  categories: [],
  owner_user_id: null,
  it_owner_user_id: null,
};

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>{node}</ThemeProvider>
    </QueryClientProvider>,
  );
}

const statusSwitch = () => screen.getByRole('checkbox', { name: 'common:statuses.enabled' });

// The status goes alone: the server keeps or sets the end of validity from its own clock.
describe('business process editors: lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.get.mockResolvedValue({ data: PROCESS });
    mocked.patch.mockResolvedValue({ data: PROCESS });
    mocked.post.mockResolvedValue({ data: { id: 'bp-2' } });
  });

  it('keeps the stored end of validity on a save that does not touch the status', async () => {
    const ref = React.createRef<BusinessProcessOverviewEditorHandle>();
    wrap(<BusinessProcessOverviewEditor ref={ref} id="bp-1" />);
    await waitFor(() => expect(screen.getByDisplayValue('Order to cash')).toBeInTheDocument());
    await ref.current!.save();
    await waitFor(() => expect(mocked.patch).toHaveBeenCalled());
    const [, body] = mocked.patch.mock.calls[0];
    expect(body).not.toHaveProperty('disabled_at');
    expect(body).not.toHaveProperty('status');
  });

  it('sends the status alone when switched off', async () => {
    const ref = React.createRef<BusinessProcessOverviewEditorHandle>();
    wrap(<BusinessProcessOverviewEditor ref={ref} id="bp-1" />);
    await waitFor(() => expect(screen.getByDisplayValue('Order to cash')).toBeInTheDocument());
    fireEvent.click(statusSwitch());
    await ref.current!.save();
    await waitFor(() => expect(mocked.patch).toHaveBeenCalled());
    const [url, body] = mocked.patch.mock.calls[0];
    expect(url).toBe('/business-processes/bp-1');
    expect(body.status).toBe('disabled');
    expect(body).not.toHaveProperty('disabled_at');
  });

  it('creates a disabled process with the status alone', async () => {
    const ref = React.createRef<BusinessProcessCreateEditorHandle>();
    wrap(<BusinessProcessCreateEditor ref={ref} />);
    fireEvent.change(screen.getByRole('textbox', { name: /shared\.fields\.name/ }), { target: { value: 'Procure to pay' } });
    fireEvent.click(statusSwitch());
    await ref.current!.save();
    await waitFor(() => expect(mocked.post).toHaveBeenCalled());
    const [, body] = mocked.post.mock.calls[0];
    expect(body.status).toBe('disabled');
    expect(body).not.toHaveProperty('disabled_at');
  });
});
