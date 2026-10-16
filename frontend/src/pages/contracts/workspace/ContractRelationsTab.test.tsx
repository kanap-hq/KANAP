import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { initReactI18next: { type: '3rdParty', init: () => undefined }, useTranslation: () => translation };
});
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
// The infrastructure right decides whether the Technologies section shows.
const access = vi.hoisted(() => ({ infrastructure: true }));
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: (resource: string) => (resource === 'infrastructure' ? access.infrastructure : true) }) }));
vi.mock('../../../components/contacts/ItemContactsSection', () => ({ default: () => null }));
vi.mock('../../../components/design', () => ({
  RelevantWebsitesList: () => null,
  useKanapDialogs: () => ({ confirm: vi.fn(async () => true) }),
}));

import api from '../../../api';
import ContractRelationsTab from './ContractRelationsTab';

const mocked = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

function renderTab(onChanged = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <ContractRelationsTab contractId="c-1" readOnly={false} links={[]} attachments={[]} onChanged={onChanged} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return onChanged;
}

describe('ContractRelationsTab technologies', () => {
  beforeEach(() => {
    access.infrastructure = true;
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/contracts/c-1/technologies') return { data: { items: [{ id: 'tec-1', name: 'SQL Server', reference: 'TEC-1' }] } };
      if (url === '/technologies/lookup') return { data: { items: [{ id: 'tec-1', name: 'SQL Server' }, { id: 'tec-2', name: 'Tomcat' }], has_more: false } };
      return { data: { items: [] } };
    });
    mocked.post.mockResolvedValue({ data: { ok: true } });
  });

  it('lists the linked technologies, adds one and removes one, each saved at once', async () => {
    const onChanged = renderTab();

    expect(screen.getByText('contracts.relations.technologies')).toBeInTheDocument();
    const chip = await screen.findByRole('button', { name: 'SQL Server' });
    const input = screen.getByPlaceholderText('contracts.relations.selectTechnologies');
    await waitFor(() => expect(input).not.toBeDisabled());

    act(() => { input.focus(); });
    fireEvent.mouseDown(input);
    fireEvent.click(await screen.findByRole('option', { name: 'Tomcat' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/contracts/c-1/technologies/bulk-replace', { technology_ids: ['tec-1', 'tec-2'] }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());

    fireEvent.click(within(chip).getByTestId('CancelIcon'));
    await waitFor(() => expect(mocked.post).toHaveBeenLastCalledWith('/contracts/c-1/technologies/bulk-replace', { technology_ids: ['tec-2'] }));
  });

  it('has no Technologies section without the right to read the infrastructure', async () => {
    access.infrastructure = false;
    renderTab();
    await screen.findByPlaceholderText('contracts.relations.selectApplications');
    expect(screen.queryByText('contracts.relations.technologies')).toBeNull();
    expect(mocked.get.mock.calls.map((c) => c[0])).not.toContain('/contracts/c-1/technologies');
  });
});
