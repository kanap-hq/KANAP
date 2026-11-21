import '../../i18n';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api';
import { createAppTheme } from '../../config/ThemeContext';
import CreateContactDialog from './CreateContactDialog';

vi.mock('../../api', () => ({ default: { post: vi.fn() } }));
const mocked = vi.mocked(api);

function renderDialog(onResolve = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <CreateContactDialog request={{ key: 1, typed: 'Zed' }} onResolve={onResolve} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return onResolve;
}

const fill = (name: string, value: string) => fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } });

// Lot A1 of 26.11.9 (Fried, 21/11): the dialog takes the job title, optional, after the email.
describe('CreateContactDialog', () => {
  beforeEach(() => {
    mocked.post.mockReset();
    mocked.post.mockResolvedValue({ data: { id: 'c-9', email: 'zed@acme.test' } } as never);
  });

  it('sends the job title typed, trimmed, after the email', async () => {
    const onResolve = renderDialog();
    const labels = screen.getAllByRole('textbox').map((field) => field.getAttribute('aria-label'));
    expect(labels).toEqual(['First name', 'Last name', 'Email', 'Job title']);
    fill('Email', 'zed@acme.test');
    fill('Job title', ' Account manager ');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/contacts', expect.objectContaining({ email: 'zed@acme.test', job_title: 'Account manager' })));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(expect.objectContaining({ id: 'c-9' })));
  });

  it('sends null for an empty job title, and Enter in that field creates', async () => {
    renderDialog();
    fill('Email', 'zed@acme.test');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Job title' }), { key: 'Enter' });
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/contacts', expect.objectContaining({ job_title: null })));
  });

  it('still asks for the email alone', async () => {
    renderDialog();
    fill('Job title', 'Buyer');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Enter the email address.')).toBeInTheDocument();
    expect(mocked.post).not.toHaveBeenCalled();
  });
});
