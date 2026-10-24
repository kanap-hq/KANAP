import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import { KanapDialogProvider } from '../../../components/design/KanapDialogProvider';
import api from '../../../api';
import { ApplicationFeedbackProvider } from '../applicationFeedback';
import i18n from '../../../i18n';
import ApplicationRelationsPanel from './ApplicationRelationsPanel';

vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../../hooks/useApplicationClassificationCatalog', () => ({ default: () => ({ data: { businessCriticalityLevels: [] } }) }));
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({ default: () => ({ labelFor: (_f: string, code: string) => code }) }));
vi.mock('../workspace/ApplicationRelationsTab', () => ({ default: () => null }));

const mocked = vi.mocked(api);

function Location() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderPanel() {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/applications/app-1/links') return { data: [] } as never;
    if (url === '/applications/app-1/attachments') return { data: [] } as never;
    if (url === '/applications/app-1/components') return { data: { items: [{ id: 'app-2', reference: 'APP-2', name: 'Billing module', lifecycle: 'active', criticality: 'high' }] } } as never;
    throw new Error(`unexpected GET ${url}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={['/it/applications/app-1/relations']}>
            <Routes>
              <Route path="*" element={<ApplicationFeedbackProvider onError={() => undefined}><ApplicationRelationsPanel id="app-1" isSuite /><Location /></ApplicationFeedbackProvider>} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  mocked.get.mockReset();
  mocked.post.mockReset();
});

describe('ApplicationRelationsPanel', () => {
  it('opens a component of a suite through a router link, without reloading the page', async () => {
    renderPanel();
    const link = await screen.findByRole('link', { name: 'Billing module' });
    expect(link.getAttribute('href')).toBe('/it/applications/APP-2/overview');
    fireEvent.click(link);
    expect(screen.getByTestId('location').textContent).toBe('/it/applications/APP-2/overview');
  });

  it('says a web link was added', async () => {
    mocked.post.mockResolvedValue({ data: {} } as never);
    renderPanel();
    fireEvent.click(await screen.findByText('Add link'));
    fireEvent.change(await screen.findByLabelText('URL'), { target: { value: 'https://docs.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/applications/app-1/links', { description: null, url: 'https://docs.example.com' }));
    expect(await screen.findByText('Link added.')).toBeTruthy();
  });

  it('says when a file is attached and when it is deleted', async () => {
    renderPanel();
    let stored = false;
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/applications/app-1/attachments') return { data: stored ? [{ id: 'f-1', original_filename: 'Architecture.pdf', size: 1, uploaded_at: '2026-10-24T00:00:00Z' }] : [] } as never;
      if (url === '/applications/app-1/links') return { data: [] } as never;
      return { data: { items: [] } } as never;
    });
    mocked.post.mockImplementation(async () => { stored = true; return { data: {} } as never; });
    mocked.patch.mockResolvedValue({ data: {} } as never);
    fireEvent.change(await screen.findByLabelText('Attach file'), { target: { files: [new File(['x'], 'Architecture.pdf', { type: 'application/pdf' })] } });
    expect(await screen.findByText('File attached.')).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete file Architecture.pdf' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/applications/attachments/f-1/delete', {}));
    expect(await screen.findByText('File deleted.')).toBeTruthy();
  });
});
