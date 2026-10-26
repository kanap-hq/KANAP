import React from 'react';
import { act, cleanup, render, screen, within } from '@testing-library/react';
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
  { lang: 'en', nameLabel: 'Name', labels: ['Description', 'Supplier', 'Category', 'Publisher', 'Lifecycle', 'Can have child apps', 'Go live', 'End of support', 'Retired date'], placeholder: 'e.g., 4.2.1, 2023, Q1 2024', nameRequired: 'Name is required' },
  { lang: 'fr', nameLabel: 'Nom', labels: ['Description', 'Fournisseur', 'Catégorie', 'Éditeur', 'Cycle de vie', 'Peut contenir des applications enfants', 'Mise en service', 'Fin de support', 'Date de retrait'], placeholder: 'ex. : 4.2.1, 2023, T1 2024', nameRequired: 'Le nom est requis' },
  { lang: 'de', nameLabel: 'Name', labels: ['Beschreibung', 'Lieferant', 'Kategorie', 'Herausgeber', 'Lebenszyklus', 'Kann untergeordnete Anwendungen haben', 'Inbetriebnahme', 'Ende des Supports', 'Außerbetriebnahmedatum'], placeholder: 'z. B. 4.2.1, 2023, Q1 2024', nameRequired: 'Name ist erforderlich' },
  { lang: 'es', nameLabel: 'Nombre', labels: ['Descripción', 'Proveedor', 'Categoría', 'Editor', 'Ciclo de vida', 'Puede contener aplicaciones secundarias', 'Puesta en marcha', 'Fin de soporte', 'Fecha de retiro'], placeholder: 'p. ej., 4.2.1, 2023, T1 2024', nameRequired: 'El nombre es obligatorio' },
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
        <ApplicationCreateEditor ref={ref}>{({ properties, body }) => <><div data-testid="properties">{properties}</div><div data-testid="body">{body}</div></>}</ApplicationCreateEditor>
      </ThemeProvider>,
    );

    for (const label of c.labels) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    // The name is typed in the header, not as a field of the form.
    expect(screen.queryByText(c.nameLabel)).toBeNull();
    expect(screen.getByPlaceholderText(c.placeholder)).toBeInTheDocument();

    await act(async () => { await ref.current?.save(); });
    expect(screen.getByText(c.nameRequired)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('posts the header name with the same payload', async () => {
    post.mockResolvedValue({ data: { id: 'app-9' } });
    const ref = React.createRef<ApplicationCreateEditorHandle>();
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <ApplicationCreateEditor ref={ref} />
      </ThemeProvider>,
    );
    await act(async () => { ref.current?.setName('  Billing  '); });
    let id: string | null = null;
    await act(async () => { id = (await ref.current?.save()) ?? null; });
    expect(id).toBe('app-9');
    expect(post).toHaveBeenCalledWith('/applications', {
      name: 'Billing',
      supplier_id: null,
      category: 'business',
      description: null,
      editor: null,
      retired_date: null,
      lifecycle: 'active',
      criticality: null,
      cyber_criticality: null,
      recovery_wave: null,
      external_facing: false,
      is_suite: false,
      last_dr_test: null,
      etl_enabled: false,
      contains_pii: false,
      data_class: null,
      version: null,
      go_live_date: null,
      end_of_support_date: null,
      users_mode: 'it_users',
      users_year: new Date().getFullYear(),
      users_override: null,
    });
  });

  it('renders the drawer fields and the description into separate hosts', () => {
    const propertiesHost = document.createElement('div');
    const bodyHost = document.createElement('div');
    document.body.append(propertiesHost, bodyHost);
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <ApplicationCreateEditor presentation="split" propertiesHost={propertiesHost} bodyHost={bodyHost} />
      </ThemeProvider>,
    );
    expect(propertiesHost.textContent).toContain('Supplier');
    expect(propertiesHost.textContent).toContain('Category');
    expect(propertiesHost.textContent).toContain('Lifecycle');
    expect(propertiesHost.textContent).toContain('Can have child apps');
    expect(propertiesHost.textContent).not.toContain('Description');
    expect(propertiesHost.textContent).not.toContain('Version information');
    expect(bodyHost.textContent).toContain('Description');
    expect(bodyHost.textContent).not.toContain('Supplier');
    propertiesHost.remove();
    bodyHost.remove();
  });
});
