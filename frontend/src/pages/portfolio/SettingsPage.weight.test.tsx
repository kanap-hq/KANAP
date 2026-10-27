import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import i18n from '../../i18n';
import SettingsPage from './SettingsPage';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn() }));
vi.mock('../../api', () => ({ default: api }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));

function renderPage() {
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <KanapDialogProvider>
        <MemoryRouter><SettingsPage /></MemoryRouter>
      </KanapDialogProvider>
    </ThemeProvider>,
  );
}

describe('portfolio criterion weight', () => {
  beforeEach(async () => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.get.mockImplementation(async (url: string) => {
      if (url === '/portfolio/skills') return { data: { items: [], grouped: {} } };
      if (url === '/portfolio/classification/all') return { data: { sources: [], categories: [], taskTypes: [] } };
      if (url === '/portfolio/settings') return { data: { mandatory_bypass_enabled: false } };
      return { data: [] };
    });
    api.post.mockResolvedValue({ data: { id: 'criterion-1' } });
    await i18n.changeLanguage('fr');
  });

  it('sends 1.5 when French types 1,5 as the criterion weight', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter un critère' }));
    const dialog = await screen.findByRole('dialog', { name: 'Créer un critère' });

    expect(await within(dialog).findByDisplayValue('Bas')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Nom' }), { target: { value: 'Impact' } });
    const weight = within(dialog).getByRole('textbox', { name: 'Pondération' });
    fireEvent.change(weight, { target: { value: '1,5' } });

    expect(weight).toHaveValue('1,5');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/portfolio/criteria', expect.objectContaining({
      name: 'Impact',
      weight: 1.5,
    })));
  });
});
