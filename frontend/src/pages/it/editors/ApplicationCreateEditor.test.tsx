import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  {
    lang: 'en',
    nameLabel: 'Name',
    description: 'Description',
    // Shared fields first, in the record drawer order, then lifecycle and the
    // classification fields, then the suite checkbox.
    order: ['Category', 'Supplier', 'Publisher', 'Version', 'Go live date', 'End of support', 'Retired date', 'Lifecycle', 'Business criticality', 'Cyber criticality', 'Data confidentiality', 'Recovery wave', 'Can have child apps'],
    absent: 'Go live',
    placeholder: 'e.g., 4.2.1, 2023, Q1 2024',
    nameRequired: 'Name is required',
  },
  {
    lang: 'fr',
    nameLabel: 'Nom',
    description: 'Description',
    order: ['Catégorie', 'Fournisseur', 'Éditeur', 'Version', 'Date de mise en service', 'Fin de support', 'Date de retrait', 'Cycle de vie', 'Criticité business', 'Criticité cyber', 'Confidentialité des données', 'Vague de reprise', 'Peut contenir des applications enfants'],
    absent: 'Mise en service',
    placeholder: 'ex. : 4.2.1, 2023, T1 2024',
    nameRequired: 'Le nom est requis',
  },
  {
    lang: 'de',
    nameLabel: 'Name',
    description: 'Beschreibung',
    order: ['Kategorie', 'Lieferant', 'Herausgeber', 'Version', 'Inbetriebnahmedatum', 'Ende des Supports', 'Außerbetriebnahmedatum', 'Lebenszyklus', 'Geschäftskritikalität', 'Cyberkritikalität', 'Datenvertraulichkeit', 'Wiederanlaufwelle', 'Kann untergeordnete Anwendungen haben'],
    absent: 'Inbetriebnahme',
    placeholder: 'z. B. 4.2.1, 2023, Q1 2024',
    nameRequired: 'Name ist erforderlich',
  },
  {
    lang: 'es',
    nameLabel: 'Nombre',
    description: 'Descripción',
    order: ['Categoría', 'Proveedor', 'Editor', 'Versión', 'Fecha de puesta en marcha', 'Fin de soporte', 'Fecha de retiro', 'Ciclo de vida', 'Criticidad de negocio', 'Criticidad cibernética', 'Confidencialidad de los datos', 'Ola de recuperación', 'Puede contener aplicaciones secundarias'],
    absent: 'Puesta en marcha',
    placeholder: 'p. ej., 4.2.1, 2023, T1 2024',
    nameRequired: 'El nombre es obligatorio',
  },
];

function assertLabelOrder(text: string, labels: string[]) {
  let from = 0;
  for (const label of labels) {
    const index = text.indexOf(label, from);
    expect(index, label).toBeGreaterThanOrEqual(from);
    from = index + label.length;
  }
}

describe('ApplicationCreateEditor', () => {
  beforeEach(() => {
    post.mockReset();
  });

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

    assertLabelOrder(document.body.textContent || '', c.order);
    // The record drawer says "Go live date", not the header's shorter "Go live".
    expect(screen.queryByText((content) => content === c.absent)).toBeNull();
    expect(screen.getByText(c.description)).toBeInTheDocument();
    // The name is typed in the header, not as a field of the form.
    expect(screen.queryByText(c.nameLabel)).toBeNull();
    expect(screen.getByPlaceholderText(c.placeholder)).toBeInTheDocument();

    await act(async () => { await ref.current?.save(); });
    expect(screen.getByText(c.nameRequired)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    await act(async () => { ref.current?.dismissNameError(); });
    expect(screen.queryByText(c.nameRequired)).toBeNull();
  });

  it('keeps a save refusal when the name error is dismissed', async () => {
    post.mockRejectedValueOnce({ response: { status: 400, data: { message: 'Name already used' } } });
    const ref = React.createRef<ApplicationCreateEditorHandle>();
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <ApplicationCreateEditor ref={ref} />
      </ThemeProvider>,
    );
    await act(async () => { ref.current?.setName('Billing'); });
    await act(async () => { await ref.current?.save().catch(() => undefined); });
    expect(screen.getByText('Name already used')).toBeInTheDocument();
    await act(async () => { ref.current?.dismissNameError(); });
    expect(screen.getByText('Name already used')).toBeInTheDocument();
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
    assertLabelOrder(propertiesHost.textContent || '', CASES[0].order);
    expect(propertiesHost.textContent).not.toContain('Description');
    expect(propertiesHost.textContent).not.toContain('Version information');
    expect(bodyHost.textContent).toContain('Description');
    expect(bodyHost.textContent).not.toContain('Supplier');
    propertiesHost.remove();
    bodyHost.remove();
  });
});
