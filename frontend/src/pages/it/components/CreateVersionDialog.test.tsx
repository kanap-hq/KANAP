import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import { createAppTheme } from '../../../config/ThemeContext';
import CreateVersionDialog from './CreateVersionDialog';

const get = vi.fn();
vi.mock('../../../api', () => ({ default: { get: (...args: any[]) => get(...args), post: vi.fn() } }));

const INTERFACES = [
  { id: 'i-1', name: 'Orders feed', lifecycle: 'active', source_app_name: 'Billing hub', target_app_name: 'Ledger', app_role: 'source' },
  { id: 'i-2', name: 'Stock sync', lifecycle: 'active', source_app_name: 'Shop', target_app_name: 'Depot', app_role: 'via_middleware' },
];

const CASES = [
  {
    lang: 'en',
    title: 'Create new version',
    defaultName: 'Billing hub - new version',
    next: 'Next',
    deployments: 'Deployments',
    budget: 'Budget items',
    asRole: 'Billing hub → Ledger (as source)',
    selected: '0 of 2 selected',
  },
  {
    lang: 'fr',
    title: 'Créer une nouvelle version',
    defaultName: 'Billing hub - nouvelle version',
    next: 'Suivant',
    deployments: 'Déploiements',
    budget: 'Postes budgétaires',
    asRole: 'Billing hub → Ledger (en tant que source)',
    selected: '0 sur 2 sélectionnée',
  },
  {
    lang: 'de',
    title: 'Neue Version erstellen',
    defaultName: 'Billing hub - neue Version',
    next: 'Weiter',
    deployments: 'Bereitstellungen',
    budget: 'Budgetposten',
    asRole: 'Billing hub → Ledger (als Quelle)',
    selected: '0 von 2 ausgewählt',
  },
  {
    lang: 'es',
    title: 'Crear nueva versión',
    defaultName: 'Billing hub - nueva versión',
    next: 'Siguiente',
    deployments: 'Despliegues',
    budget: 'Partidas presupuestarias',
    asRole: 'Billing hub → Ledger (como origen)',
    selected: '0 de 2 seleccionadas',
  },
];

describe('CreateVersionDialog', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue({ data: INTERFACES });
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it.each(CASES)('walks the three steps in $lang', async (c) => {
    await i18n.changeLanguage(c.lang);
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <CreateVersionDialog open onClose={vi.fn()} onSuccess={vi.fn()} sourceApp={{ id: 'app-1', name: 'Billing hub', version: '1.0' }} />
      </ThemeProvider>,
    );

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(c.title)).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue(c.defaultName)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: c.next }));
    expect(within(dialog).getByText(c.deployments)).toBeInTheDocument();
    expect(within(dialog).getByText(c.budget)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: c.next }));
    expect(await within(dialog).findByText(c.asRole)).toBeInTheDocument();
    expect(within(dialog).getByText(c.selected)).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/applications/app-1/interfaces-for-migration');
  });
});
