import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import InterfaceWorkspacePage from './InterfaceWorkspacePage';

const post = vi.fn();
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: (...args: any[]) => post(...args), patch: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../hooks/useModuleItemNav', () => ({
  useInterfaceItemNav: () => ({ total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: vi.fn() }) }));
vi.mock('./components/InterfaceBindingsMatrix', () => ({ default: () => null }));
vi.mock('./workspace/InterfaceFlowTab', () => ({ default: () => null }));
vi.mock('./workspace/InterfaceMappingTab', () => ({ default: () => null }));
vi.mock('./workspace/InterfaceMetadataBar', () => ({ default: () => null }));
vi.mock('./workspace/InterfaceOverviewTab', () => ({ default: () => null }));
vi.mock('./workspace/InterfacePropertyPanel', () => ({ default: () => null }));
vi.mock('./workspace/InterfaceRelationsTab', () => ({ default: () => null }));
// The shell is covered elsewhere; this stub shows what the page hands it.
vi.mock('../portfolio/workspace/PortfolioDetailWorkspaceShell', () => ({
  default: (props: any) => (
    <div>
      <nav>{props.tabs.map((tab: any) => <span key={tab.key}>{tab.label}</span>)}</nav>
      <h1>{props.title || props.titleFallback}</h1>
      <div>{props.actions}</div>
      <main>{props.children}</main>
    </div>
  ),
}));

const CASES = [
  { lang: 'en', texts: ['Overview', 'Flow', 'Environments', 'Data mapping', 'Relations', 'New interface'], create: 'Create', nameRequired: 'Name is required.' },
  { lang: 'fr', texts: ["Vue d'ensemble", 'Flux', 'Environnements', 'Mappage des données', 'Relations', 'Nouvelle interface'], create: 'Créer', nameRequired: 'Le nom est requis.' },
  { lang: 'de', texts: ['Übersicht', 'Fluss', 'Umgebungen', 'Datenzuordnung', 'Beziehungen', 'Neue Schnittstelle'], create: 'Erstellen', nameRequired: 'Name ist erforderlich.' },
  { lang: 'es', texts: ['Vista general', 'Flujo', 'Entornos', 'Mapeo de datos', 'Relaciones', 'Nueva interfaz'], create: 'Crear', nameRequired: 'El nombre es obligatorio.' },
];

describe('InterfaceWorkspacePage (create)', () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it.each(CASES)('shows the tabs and the name check in $lang', async (c) => {
    await i18n.changeLanguage(c.lang);
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={['/it/interfaces/new/overview']}>
          <Routes>
            <Route path="/it/interfaces/:id/:tab" element={<InterfaceWorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    );

    for (const text of c.texts) expect(screen.getByText(text)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: c.create }));
    expect(await screen.findByText(c.nameRequired)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
});
