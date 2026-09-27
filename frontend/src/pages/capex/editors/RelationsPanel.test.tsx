import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../../components/contacts/ItemContactsSection', () => ({ default: () => null }));
vi.mock('../../../components/design', () => ({
  RelevantWebsitesList: () => null,
  useKanapDialogs: () => ({ confirm: vi.fn(async () => true) }),
}));

import api from '../../../api';
import RelationsPanel, { RelationsPanelHandle } from './RelationsPanel';

const mocked = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

describe('CAPEX RelationsPanel applications', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/capex-items/item-1/applications') return { data: { items: [{ id: 'app-1', name: 'Payroll' }, { id: 'app-2', name: 'Ledger' }] } };
      if (url.endsWith('/links') || url.endsWith('/attachments')) return { data: [] };
      return { data: { items: [] } };
    });
    mocked.post.mockResolvedValue({ data: {} });
  });

  it('loads the linked applications and saves the new set', async () => {
    const ref = React.createRef<RelationsPanelHandle>();
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <RelationsPanel ref={ref} id="item-1" autoSave={false} />
      </ThemeProvider>,
    );

    expect(screen.getByText('capex.relations.applications')).toBeInTheDocument();
    const chip = await screen.findByRole('button', { name: 'Payroll' });
    expect(screen.getByRole('button', { name: 'Ledger' })).toBeInTheDocument();
    expect(mocked.get).toHaveBeenCalledWith('/capex-items/item-1/applications');

    // Unlink one application, then save.
    fireEvent.click(within(chip).getByTestId('CancelIcon'));
    await waitFor(() => expect(ref.current?.isDirty()).toBe(true));
    await act(async () => { await ref.current?.save(); });

    expect(mocked.post).toHaveBeenCalledWith('/capex-items/item-1/applications/bulk-replace', { application_ids: ['app-2'] });
    // Projects and contracts did not change: nothing is posted for them.
    expect(mocked.post).toHaveBeenCalledTimes(1);
  });

  it('never posts a set whose load failed, and keeps it read-only', async () => {
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/capex-items/item-1/applications') throw new Error('network');
      if (url === '/capex-items/item-1/projects') return { data: { items: [{ id: 'prj-1', name: 'Migration' }] } };
      if (url.endsWith('/links') || url.endsWith('/attachments')) return { data: [] };
      return { data: { items: [] } };
    });
    const ref = React.createRef<RelationsPanelHandle>();
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <RelationsPanel ref={ref} id="item-1" autoSave={false} />
      </ThemeProvider>,
    );

    const chip = await screen.findByRole('button', { name: 'Migration' });
    expect(screen.getByText('capex.relations.failedToLoad')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('capex.relations.selectApplications')).toBeDisabled();

    fireEvent.click(within(chip).getByTestId('CancelIcon'));
    await waitFor(() => expect(ref.current?.isDirty()).toBe(true));
    await act(async () => { await ref.current?.save(); });

    expect(mocked.post).toHaveBeenCalledWith('/capex-items/item-1/projects/bulk-replace', { project_ids: [] });
    expect(mocked.post.mock.calls.map((c) => c[0])).not.toContain('/capex-items/item-1/applications/bulk-replace');
    expect(mocked.post).toHaveBeenCalledTimes(1);
  });

  it('posts nothing when no set changed', async () => {
    const ref = React.createRef<RelationsPanelHandle>();
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <RelationsPanel ref={ref} id="item-1" autoSave={false} />
      </ThemeProvider>,
    );
    await screen.findByRole('button', { name: 'Payroll' });
    await act(async () => { await ref.current?.save(); });
    expect(mocked.post).not.toHaveBeenCalled();
  });
});
