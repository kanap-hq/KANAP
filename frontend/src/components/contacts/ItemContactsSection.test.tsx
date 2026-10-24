import '../../i18n';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { createAppTheme } from '../../config/ThemeContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api';

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../fields/ContactSelect', () => ({
  default: ({ onChange }: { onChange: (id: string | null) => void }) => (
    <button type="button" onClick={() => onChange('contact-2')}>pick contact</button>
  ),
}));

import ItemContactsSection from './ItemContactsSection';

const mocked = vi.mocked(api);
const refusal = { response: { status: 403, data: { code: 'DATA_ACCESS_LIMITED', message: 'This line is read only in your access.' } } };

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ItemContactsSection itemType="spend-items" itemId="line-1" canManage />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('ItemContactsSection', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.delete.mockReset();
    mocked.post.mockReset();
    mocked.get.mockResolvedValue({
      data: [{
        id: 'link-1', contact_id: 'contact-1', role: 'commercial', origin: 'manual',
        contact: { id: 'contact-1', first_name: 'Ana', last_name: 'Lopez', job_title: null, email: 'ana@example.invalid', mobile: null },
      }],
    } as never);
  });

  it('says why a removal was refused and keeps the contact', async () => {
    mocked.delete.mockRejectedValue(refusal);
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove contact' }));
    expect(await screen.findByText('This line is read only in your access.')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
  });

  it('says why an add was refused', async () => {
    mocked.post.mockRejectedValue(refusal);
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'pick contact' }));
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'Commercial' }));
    expect(await screen.findByText('This line is read only in your access.')).toBeInTheDocument();
  });
});
