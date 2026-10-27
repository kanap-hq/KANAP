import '../../../i18n';
import type { ComponentProps } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LogTimeDialog from './LogTimeDialog';
import { createAppTheme } from '../../../config/ThemeContext';
import { formatShortDate } from '../../../lib/dateFormat';
import { localTodayYmd } from '../../../lib/datetime';
import api from '../../../api';

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn(async () => ({ data: { items: [{ id: 'user-1', first_name: 'Ada', last_name: 'Martin' }], has_more: false } })),
    post: vi.fn(async () => ({ data: {} })),
    patch: vi.fn(async () => ({ data: {} })),
  },
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'user-1', first_name: 'Ada', last_name: 'Martin' } }),
}));

function renderDialog(editEntry?: ComponentProps<typeof LogTimeDialog>['editEntry']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <LogTimeDialog
          open
          onClose={() => {}}
          projectId="p-1"
          onSuccess={() => {}}
          editEntry={editEntry}
        />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('LogTimeDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends today when logging time on a project', async () => {
    const today = localTodayYmd();
    renderDialog();

    expect(screen.getByText('Date')).toBeTruthy();
    expect(screen.getByDisplayValue(formatShortDate(today, 'en', { year: 'always' }))).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/^Hours/), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log time' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/portfolio/projects/p-1/time-entries', {
      category: 'it',
      user_id: 'user-1',
      hours: 2,
      notes: null,
      logged_at: today,
    });
  });

  it('sends the entry day when editing', async () => {
    renderDialog({
      id: 'e-1',
      category: 'business',
      user_id: 'user-1',
      hours: 10,
      notes: 'Workshop',
      logged_at: '2020-03-15T00:00:00.000Z',
    });

    expect(screen.getByDisplayValue(formatShortDate('2020-03-15', 'en'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch).toHaveBeenCalledWith('/portfolio/projects/p-1/time-entries/e-1', {
      category: 'business',
      user_id: 'user-1',
      hours: 10,
      notes: 'Workshop',
      logged_at: '2020-03-15',
    });
  });
});
