import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import ConnectionWorkspacePage from './ConnectionWorkspacePage';

const post = vi.fn();
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: (...args: any[]) => post(...args), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../hooks/useApplicationClassificationCatalog', () => ({ default: () => ({ data: undefined }) }));
vi.mock('../../hooks/useItOpsEnumOptions', () => {
  const value = {
    settings: { connectionTypes: [{ code: 'https', label: 'HTTPS' }] },
    byField: { lifecycleStatus: [{ code: 'active', label: 'Active' }], dataClass: [] },
  };
  return { default: () => value };
});
vi.mock('../../hooks/useModuleItemNav', () => ({
  useConnectionItemNav: () => ({ total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: vi.fn() }) }));
vi.mock('./workspace/ConnectionEndpointPicker', () => ({ default: ({ label }: { label: string }) => <div>{label}</div> }));
// The shell is covered elsewhere; this stub shows what the page hands it.
vi.mock('../portfolio/workspace/PortfolioDetailWorkspaceShell', () => ({
  default: (props: any) => (
    <div>
      <nav>{props.tabs.map((tab: any) => <span key={tab.key}>{tab.label}</span>)}</nav>
      <h1>{props.title || props.titleFallback}</h1>
      <div>{props.actions}</div>
      <aside>{props.properties}</aside>
      <main>{props.children}</main>
    </div>
  ),
}));

const CASES = [
  {
    lang: 'en',
    texts: ['Overview', 'Path', 'New connection', 'Create connection', 'Endpoints', 'Source', 'Destination', 'Topology', 'Risk mode', 'Manual', 'After creation'],
    namePlaceholder: 'e.g., App tier to DB tier',
    create: 'Create',
    nameRequired: 'Name is required.',
  },
  {
    lang: 'fr',
    texts: ["Vue d'ensemble", 'Chemin', 'Nouvelle connexion', 'Créer une connexion', 'Endpoints', 'Source', 'Destination', 'Topologie', 'Mode de risque', 'Manuel', 'Après la création'],
    namePlaceholder: 'ex. : Niveau applicatif vers niveau base de données',
    create: 'Créer',
    nameRequired: 'Le nom est requis.',
  },
  {
    lang: 'de',
    texts: ['Übersicht', 'Pfad', 'Neue Verbindung', 'Verbindung erstellen', 'Endpunkte', 'Quelle', 'Ziel', 'Topologie', 'Risikomodus', 'Manuell', 'Nach dem Erstellen'],
    namePlaceholder: 'z. B. App-Schicht zu DB-Schicht',
    create: 'Erstellen',
    nameRequired: 'Name ist erforderlich.',
  },
  {
    lang: 'es',
    texts: ['Vista general', 'Ruta', 'Nueva conexión', 'Crear conexión', 'Endpoints', 'Origen', 'Destino', 'Topología', 'Modo de riesgo', 'Manual', 'Tras la creación'],
    namePlaceholder: 'p. ej., Capa de aplicación a capa de base de datos',
    create: 'Crear',
    nameRequired: 'El nombre es obligatorio.',
  },
];

describe('ConnectionWorkspacePage (create)', () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it.each(CASES)('shows the create form in $lang', async (c) => {
    await i18n.changeLanguage(c.lang);
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={['/it/connections/new/overview']}>
          <Routes>
            <Route path="/it/connections/:id/:tab" element={<ConnectionWorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    );

    for (const text of c.texts) expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText(c.namePlaceholder)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: c.create }));
    expect(screen.getByText(c.nameRequired)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
});
