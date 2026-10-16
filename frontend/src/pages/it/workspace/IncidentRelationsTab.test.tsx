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
vi.mock('../../../api/endpoints/incidents', () => ({
  incidentsApi: {
    listAssets: vi.fn(async () => []),
    replaceAssets: vi.fn(async () => []),
    listApplications: vi.fn(async () => []),
    replaceApplications: vi.fn(async () => []),
    listTechnologies: vi.fn(),
    replaceTechnologies: vi.fn(),
  },
}));
// The infrastructure right decides whether the Technologies field shows.
const access = vi.hoisted(() => ({ infrastructure: true }));
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: (resource: string) => (resource === 'infrastructure' ? access.infrastructure : true) }) }));
vi.mock('../../../components/EntityTasksPanel', () => ({ default: () => null }));

import api from '../../../api';
import { incidentsApi } from '../../../api/endpoints/incidents';
import IncidentRelationsTab from './IncidentRelationsTab';

const mockedGet = api.get as unknown as ReturnType<typeof vi.fn>;
const incidents = incidentsApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const SQL = { id: 'tec-1', name: 'SQL Server', reference: 'TEC-1' };
const TOMCAT = { id: 'tec-2', name: 'Tomcat', reference: 'TEC-2' };

function renderTab(onLinksChange = vi.fn(), readOnly = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <IncidentRelationsTab incidentId="inc-1" readOnly={readOnly} onLinksChange={onLinksChange} onTasksChange={vi.fn()} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return onLinksChange;
}

describe('IncidentRelationsTab technologies', () => {
  beforeEach(() => {
    access.infrastructure = true;
    mockedGet.mockReset();
    mockedGet.mockImplementation(async (url: string) => (url === '/technologies/lookup' ? { data: { items: [SQL, TOMCAT] } } : { data: { items: [] } }));
    incidents.listTechnologies.mockReset();
    incidents.listTechnologies.mockResolvedValue([SQL]);
    incidents.replaceTechnologies.mockReset();
    incidents.replaceTechnologies.mockImplementation(async (_id: string, ids: string[]) => [SQL, TOMCAT].filter((row) => ids.includes(row.id)));
  });

  it('lists the linked technologies with their reference, adds one and removes one', async () => {
    const onLinksChange = renderTab();

    expect(screen.getByText('workspace.incident.relations.technologies')).toBeInTheDocument();
    const chip = await screen.findByRole('button', { name: 'TEC-1 · SQL Server' });
    const input = screen.getByPlaceholderText('workspace.incident.relations.technologiesPlaceholder');

    act(() => { input.focus(); });
    fireEvent.mouseDown(input);
    fireEvent.click(await screen.findByRole('option', { name: 'TEC-2 · Tomcat' }));
    await waitFor(() => expect(incidents.replaceTechnologies).toHaveBeenCalledWith('inc-1', ['tec-1', 'tec-2']));
    await waitFor(() => expect(onLinksChange).toHaveBeenCalledWith('technologies', 2));
    expect(mockedGet).toHaveBeenCalledWith('/technologies/lookup', expect.objectContaining({ params: { limit: 50 } }));

    fireEvent.click(within(chip).getByTestId('DeleteIcon'));
    await waitFor(() => expect(incidents.replaceTechnologies).toHaveBeenLastCalledWith('inc-1', ['tec-2']));
    await waitFor(() => expect(onLinksChange).toHaveBeenLastCalledWith('technologies', 1));
  });

  it('has no Technologies field without the right to read the infrastructure', async () => {
    access.infrastructure = false;
    renderTab();
    await screen.findByPlaceholderText('workspace.incident.relations.applicationsPlaceholder');
    expect(screen.queryByText('workspace.incident.relations.technologies')).toBeNull();
    expect(incidents.listTechnologies).not.toHaveBeenCalled();
  });
});
