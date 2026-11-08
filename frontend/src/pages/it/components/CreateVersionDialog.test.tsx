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
    budget: 'Budget lines',
    asRole: 'Billing hub → Ledger (as source)',
    selected: '0 of 2 selected',
    gone: [
      'Creating a new version of:',
      'Select what to copy from the source application:',
      'Select interfaces to migrate to the new version. Selected interfaces will be duplicated and linked to the new version.',
      'Environment-specific details will be cleared.',
      'Interfaces marked "flows through this ETL" use this application as middleware.',
    ],
  },
  {
    lang: 'fr',
    title: 'Créer une nouvelle version',
    defaultName: 'Billing hub - nouvelle version',
    next: 'Suivant',
    deployments: 'Déploiements',
    budget: 'Lignes budgétaires',
    asRole: 'Billing hub → Ledger (en tant que source)',
    selected: '0 sur 2 sélectionnée',
    gone: [
      "Création d'une nouvelle version de :",
      "Sélectionnez les éléments à copier depuis l'application source :",
      'Sélectionnez les interfaces à migrer vers la nouvelle version. Les interfaces sélectionnées seront dupliquées et liées à la nouvelle version.',
      'Les détails propres à chaque environnement seront effacés.',
      'Les interfaces marquées « transite par cet ETL » utilisent cette application comme middleware.',
    ],
  },
  {
    lang: 'de',
    title: 'Neue Version erstellen',
    defaultName: 'Billing hub - neue Version',
    next: 'Weiter',
    deployments: 'Bereitstellungen',
    budget: 'Budgetzeilen',
    asRole: 'Billing hub → Ledger (als Quelle)',
    selected: '0 von 2 ausgewählt',
    gone: [
      'Neue Version erstellen von:',
      'Wählen Sie, was aus der Quellanwendung kopiert werden soll:',
      'Wählen Sie Schnittstellen zur Migration in die neue Version. Ausgewählte Schnittstellen werden dupliziert und mit der neuen Version verknüpft.',
      'Umgebungsspezifische Details werden gelöscht.',
      'Schnittstellen mit der Markierung „fließt durch diesen ETL“ verwenden diese Anwendung als Middleware.',
    ],
  },
  {
    lang: 'es',
    title: 'Crear nueva versión',
    defaultName: 'Billing hub - nueva versión',
    next: 'Siguiente',
    deployments: 'Despliegues',
    budget: 'Líneas presupuestarias',
    asRole: 'Billing hub → Ledger (como origen)',
    selected: '0 de 2 seleccionadas',
    gone: [
      'Creando una nueva versión de:',
      'Seleccione qué copiar de la aplicación origen:',
      'Seleccione las interfaces a migrar a la nueva versión. Las interfaces seleccionadas se duplicarán y vincularán a la nueva versión.',
      'Los detalles específicos del entorno se borrarán.',
      'Las interfaces marcadas como «fluye a través de este ETL» utilizan esta aplicación como middleware.',
    ],
  },
];

function text(key: string): string {
  return String(i18n.t(key, { ns: 'it' }));
}

function expectGone(dialog: HTMLElement, lines: string[]) {
  for (const line of lines) {
    expect(within(dialog).queryByText(line)).not.toBeInTheDocument();
  }
}

function visible(value: string): string {
  return value.replace(/[\u00a0\u202f]/g, ' ');
}

async function expectHint(icon: HTMLElement, hint: string) {
  fireEvent.mouseOver(icon);
  const tooltip = await screen.findByRole('tooltip', { name: hint });
  expect(tooltip).toHaveTextContent(visible(hint));
  fireEvent.mouseLeave(icon);
}

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
        <CreateVersionDialog open onClose={vi.fn()} onSuccess={vi.fn()} sourceApp={{ id: 'app-1', name: 'Billing hub' }} />
      </ThemeProvider>,
    );

    const dialog = await screen.findByRole('dialog');
    const copyScopeHint = `${text('components.createVersion.alwaysCopied')} ${text('components.createVersion.suitesNotCopied')}`;
    const bindingsHint = text('components.createVersion.bindingsHint');
    const middlewareHint = text('components.createVersion.middlewareHint');
    const copyStep = text('components.createVersion.steps.copyOptions');
    const bindingsLabel = text('components.createVersion.copyBindings');

    expect(within(dialog).getByText(c.title)).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue(c.defaultName)).toBeInTheDocument();
    expectGone(dialog, c.gone);
    expect(within(dialog).queryByText(text('components.createVersion.alwaysCopied'))).not.toBeInTheDocument();
    expect(within(dialog).queryByText(text('components.createVersion.suitesNotCopied'))).not.toBeInTheDocument();
    const copyHint = within(dialog).getByRole('img', { name: copyScopeHint });
    expect(within(dialog).getAllByRole('img')).toHaveLength(1);
    expect(copyHint.closest('.MuiStepLabel-label')).toHaveTextContent(copyStep);
    await expectHint(copyHint, copyScopeHint);

    fireEvent.click(within(dialog).getByRole('button', { name: c.next }));
    expect(within(dialog).getByText(c.deployments)).toBeInTheDocument();
    expect(within(dialog).getByText(c.budget)).toBeInTheDocument();
    expectGone(dialog, c.gone);
    expect(within(dialog).queryByText(bindingsHint)).not.toBeInTheDocument();
    const bindingsHintIcon = within(dialog).getByRole('img', { name: bindingsHint });
    expect(within(dialog).getAllByRole('img')).toHaveLength(2);
    expect(bindingsHintIcon.parentElement).toHaveTextContent(bindingsLabel);
    await expectHint(bindingsHintIcon, bindingsHint);

    fireEvent.click(within(dialog).getByRole('button', { name: c.next }));
    expect(await within(dialog).findByText(c.asRole)).toBeInTheDocument();
    expect(within(dialog).getByText(c.selected)).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/applications/app-1/interfaces-for-migration');
    expectGone(dialog, c.gone);
    expect(within(dialog).queryByText(middlewareHint)).not.toBeInTheDocument();
    const middlewareIcon = within(dialog).getByRole('img', { name: middlewareHint });
    expect(within(dialog).getAllByRole('img')).toHaveLength(2);
    const stock = within(dialog).getByText('Stock sync').closest('li');
    const orders = within(dialog).getByText('Orders feed').closest('li');
    expect(stock).toContainElement(middlewareIcon);
    expect(within(orders as HTMLElement).queryByRole('img')).not.toBeInTheDocument();
    fireEvent.click(middlewareIcon);
    expect(within(stock as HTMLElement).getByRole('checkbox')).not.toBeChecked();
    await expectHint(middlewareIcon, middlewareHint);
  });
});
