import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../i18n';
import { createAppTheme } from '../../../config/ThemeContext';
import { KanapDialogProvider } from '../../../components/design';
import ApplicationDeleteButton from './ApplicationDeleteButton';

const del = vi.fn();
vi.mock('../../../api', () => ({ default: { delete: (...args: any[]) => del(...args) } }));

function renderButton() {
  const onDeleted = vi.fn();
  const onError = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={queryClient}>
        <KanapDialogProvider>
          <ApplicationDeleteButton applicationId="app-1" applicationName="Billing hub" onDeleted={onDeleted} onError={onError} />
        </KanapDialogProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return { onDeleted, onError, invalidate };
}

async function openConfirm() {
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Delete Billing hub?')).toBeInTheDocument();
  expect(dialog).toHaveTextContent(/deployments/);
  expect(within(dialog).getByText(/permanently deletes Billing hub/)).toBeInTheDocument();
  return dialog;
}

describe('ApplicationDeleteButton', () => {
  beforeEach(() => {
    del.mockReset();
  });

  it('deletes the application after confirmation, refreshes the list and hands back', async () => {
    del.mockResolvedValue({ data: undefined });
    const { onDeleted, onError, invalidate } = renderButton();

    const dialog = await openConfirm();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(del).toHaveBeenCalledWith('/applications/app-1');
    expect(invalidate).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('does nothing when the confirmation is cancelled', async () => {
    const { onDeleted } = renderButton();

    const dialog = await openConfirm();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(del).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('reports a failed delete in the interface language and stays on the page', async () => {
    del.mockRejectedValue({ response: { status: 404, data: { code: 'not_found', message: 'Application not found' } } });
    const { onDeleted, onError } = renderButton();

    const dialog = await openConfirm();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith('This item no longer exists. Reload the page to see the current list.'));
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
  });
});
