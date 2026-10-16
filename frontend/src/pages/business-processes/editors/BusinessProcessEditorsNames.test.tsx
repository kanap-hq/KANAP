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

const mocked = api as unknown as Record<'get' | 'post' | 'patch', ReturnType<typeof vi.fn>>;
const duplicate = { response: { status: 409, data: { code: 'duplicate', message: 'Another business process already has this name.' } } };

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>{node}</ThemeProvider>
    </QueryClientProvider>,
  );
}

// A name another business process has (409 `duplicate`) shows under the name field, not above the form.
describe('business process editors: a name already taken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.get.mockResolvedValue({ data: { id: 'bp-1', name: 'Order to cash', status: 'enabled', disabled_at: null, categories: [] } });
  });

  it('shows the refusal of a rename under the name', async () => {
    mocked.patch.mockRejectedValueOnce(duplicate);
    const ref = React.createRef<BusinessProcessOverviewEditorHandle>();
    wrap(<BusinessProcessOverviewEditor ref={ref} id="bp-1" />);
    const input = await screen.findByDisplayValue('Order to cash');
    fireEvent.change(input, { target: { value: 'procure to pay' } });
    await expect(ref.current!.save()).rejects.toBe(duplicate);
    expect(await screen.findByText('businessProcesses.fields.nameTaken')).toBeInTheDocument();
    expect(screen.getByDisplayValue('procure to pay')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the refusal of a create under the name', async () => {
    mocked.post.mockRejectedValueOnce(duplicate);
    const ref = React.createRef<BusinessProcessCreateEditorHandle>();
    wrap(<BusinessProcessCreateEditor ref={ref} />);
    fireEvent.change(screen.getByLabelText(/shared.fields.name/), { target: { value: 'order to cash' } });
    await expect(ref.current!.save()).rejects.toBe(duplicate);
    await waitFor(() => expect(screen.getByText('businessProcesses.fields.nameTaken')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
