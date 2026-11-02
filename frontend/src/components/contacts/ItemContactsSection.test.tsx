import '../../i18n';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { createAppTheme } from '../../config/ThemeContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api';
import { RelationsSection, RelationsTable, type RelationsColumn } from '../workspace/RelationsTable';

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../fields/ContactSelect', () => ({
  default: ({ onChange }: { onChange: (id: string | null) => void }) => (
    <button type="button" onClick={() => onChange('contact-2')}>pick contact</button>
  ),
}));

import ItemContactsSection from './ItemContactsSection';

const mocked = vi.mocked(api);
const refusal = { response: { status: 403, data: { code: 'DATA_ACCESS_LIMITED', message: 'This line is read only in your access.' } } };

function renderSection(
  props: Partial<React.ComponentProps<typeof ItemContactsSection>> = {},
  sibling?: React.ReactNode,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          {sibling}
          <ItemContactsSection itemType="spend-items" itemId="line-1" canManage {...props} />
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

  it('opens the contact from the row and says why a removal was refused', async () => {
    mocked.delete.mockRejectedValue(refusal);
    renderSection();
    const link = await screen.findByRole('link', { name: 'Ana' });
    expect(link).toHaveAttribute('href', '/master-data/contacts/contact-1/overview');
    fireEvent.click(screen.getByRole('button', { name: 'Remove contact' }));
    expect(await screen.findByText('This line is read only in your access.')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
  });

  it('says why an add was refused', async () => {
    mocked.post.mockRejectedValue(refusal);
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick contact' }));
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'Commercial' }));
    expect(await screen.findByText('This line is read only in your access.')).toBeInTheDocument();
  });

  it('adds the supplier contacts from the section header', async () => {
    mocked.post.mockResolvedValue({ data: {} } as never);
    renderSection({ syncFromSupplier: true });
    fireEvent.click(await screen.findByRole('button', { name: "Add the supplier's contacts" }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/spend-items/line-1/contacts/sync-from-supplier', {}));
  });

  it('hides add and remove when the person cannot manage the item', async () => {
    renderSection({ canManage: false });
    expect(await screen.findByText('Ana')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove contact' })).toBeNull();
    expect(screen.queryByRole('button', { name: "Add the supplier's contacts" })).toBeNull();
  });

  it('takes the group width of its sibling sections', async () => {
    const frameWidth = 1600;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.tagName === 'DIV' ? frameWidth : 0;
    });
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
    try {
      // Wider than the contacts columns and narrower than the frame, so it sets the shared cap.
      const columns: Array<RelationsColumn<{ id: string }>> = Array.from({ length: 7 }, (_, index) => ({
        key: `c${index}`,
        header: `Column ${index}`,
        width: 200,
        render: () => 'value',
      }));
      renderSection(undefined, (
        <RelationsSection title="Applications">
          <RelationsTable columns={columns} rows={[{ id: 'app-1' }]} rowKey={(row) => row.id} ariaLabel="Applications" />
        </RelationsSection>
      ));
      await screen.findByRole('table', { name: 'Contacts' });
      const shared = getComputedStyle(screen.getByRole('region', { name: 'Applications' })).maxWidth;
      expect(shared).toBe('1400px');
      expect(getComputedStyle(screen.getByRole('region', { name: 'Contacts' })).maxWidth).toBe(shared);
      // The contacts table is the narrower one: it fills the shared section instead of keeping its own width.
      expect(screen.getByRole('table', { name: 'Contacts' }).style.width).toBe('');
      expect(screen.getByRole('table', { name: 'Applications' }).style.width).toBe(shared);
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });
});
