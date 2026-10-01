import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import { createAppTheme } from '../../../config/ThemeContext';
import ApplicationCreateEditor, { type ApplicationCreateEditorHandle } from './ApplicationCreateEditor';

const post = vi.fn();
vi.mock('../../../api', () => ({ default: { post: (...args: any[]) => post(...args) } }));
vi.mock('../../../components/fields/SupplierSelect', () => ({ default: () => <input aria-label="supplier" /> }));
vi.mock('../../../hooks/useApplicationClassificationCatalog', () => ({ default: () => ({ data: undefined }) }));
vi.mock('../../../hooks/useItOpsEnumOptions', () => {
  const byField = {
    applicationCategory: [{ code: 'business', label: 'Business' }],
    lifecycleStatus: [{ code: 'active', label: 'Active' }],
  };
  return { default: () => ({ byField }) };
});

const CASES = [
  { lang: 'en', labels: ['Name', 'Publisher', 'Can have child apps', 'Version information', 'Go live', 'End of support', 'Retired date'], placeholder: 'e.g., 4.2.1, 2023, Q1 2024', nameRequired: 'Name is required' },
  { lang: 'fr', labels: ['Nom', 'Éditeur', 'Peut contenir des applications enfants', 'Informations de version', 'Mise en service', 'Fin de support', 'Date de retrait'], placeholder: 'ex. : 4.2.1, 2023, T1 2024', nameRequired: 'Le nom est requis' },
  { lang: 'de', labels: ['Name', 'Herausgeber', 'Kann untergeordnete Anwendungen haben', 'Versionsinformationen', 'Inbetriebnahme', 'Ende des Supports', 'Außerbetriebnahmedatum'], placeholder: 'z. B. 4.2.1, 2023, Q1 2024', nameRequired: 'Name ist erforderlich' },
  { lang: 'es', labels: ['Nombre', 'Editor', 'Puede contener aplicaciones secundarias', 'Información de versión', 'Puesta en marcha', 'Fin de soporte', 'Fecha de retiro'], placeholder: 'p. ej., 4.2.1, 2023, T1 2024', nameRequired: 'El nombre es obligatorio' },
];

describe('ApplicationCreateEditor', () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it.each(CASES)('shows its labels and the name check in $lang', async (c) => {
    await i18n.changeLanguage(c.lang);
    const ref = React.createRef<ApplicationCreateEditorHandle>();
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <ApplicationCreateEditor ref={ref} />
      </ThemeProvider>,
    );

    for (const label of c.labels) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText(c.placeholder)).toBeInTheDocument();

    await act(async () => { await ref.current?.save(); });
    expect(screen.getByText(c.nameRequired)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
});
