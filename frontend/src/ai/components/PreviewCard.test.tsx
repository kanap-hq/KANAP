import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import i18n from '../../i18n';
import { AiMutationPreview } from '../aiTypes';
import PreviewCard from './PreviewCard';

vi.mock('../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({
    labelFor: (field: string, code?: string | null) => (field === 'lifecycleStatus' && code === 'retired' ? 'Retirée' : String(code ?? '')),
  }),
}));

function preview(overrides: Partial<AiMutationPreview>): AiMutationPreview {
  return {
    preview_id: 'preview-1',
    tool_name: 'create_task',
    status: 'pending',
    target: { entity_type: 'tasks', entity_id: null, ref: null, title: 'Migration' },
    changes: {},
    requires_confirmation: true,
    actions: ['approve', 'reject'],
    summary: '',
    error_message: null,
    conversation_id: 'conv-1',
    created_at: '2026-10-27T10:00:00.000Z',
    expires_at: null,
    approved_at: null,
    rejected_at: null,
    executed_at: null,
    ...overrides,
  };
}

function renderCard(value: AiMutationPreview) {
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <PreviewCard preview={value} onApprove={() => undefined} onReject={() => undefined} />
    </ThemeProvider>,
  );
}

describe('PreviewCard in French', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('fr');
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it('shows a task creation with the labels and values of the task screens', () => {
    renderCard(preview({
      summary: 'Création de la tâche autonome « Migration ». Priorité : Moyenne.',
      changes: {
        relation: { label: 'Relation', from: null, to: 'Standalone', format: 'text' },
        title: { label: 'Title', from: null, to: 'Migration', format: 'text' },
        priority: { label: 'Priority', from: null, to: 'Normal', format: 'text' },
        status: { label: 'Status', from: null, to: 'Open', format: 'text' },
        due_date: { label: 'Due Date', from: null, to: null, format: 'text' },
      },
    }));

    for (const text of ['Rattachement', 'Autonome', 'Titre', 'Priorité', 'Moyenne', 'Statut', 'Ouvert', 'Échéance']) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByText('Création de la tâche autonome « Migration ». Priorité : Moyenne.')).toBeInTheDocument();
    expect(screen.queryByText('Standalone')).not.toBeInTheDocument();
    expect(screen.queryByText('Normal')).not.toBeInTheDocument();
  });

  it('shows an application change with catalog values and keeps the names it does not know', () => {
    renderCard(preview({
      tool_name: 'update_business_record',
      target: { entity_type: 'applications', entity_id: 'app-1', ref: null, title: 'CheeseTrack' },
      changes: {
        lifecycle: { label: 'Lifecycle', from: 'active', to: 'retired', format: 'text' },
        criticality: { label: 'Business criticality', from: 'Modérée', to: 'Élevée', format: 'text' },
        external_facing: { label: 'External Facing', from: 'No', to: 'Yes', format: 'text' },
        environment: { label: 'Environment', from: null, to: 'pre_prod', format: 'text' },
        'analytics_axis:pool': { label: 'Pool de coûts', from: null, to: 'Infra', format: 'text' },
      },
    }));

    for (const text of ['Cycle de vie', 'Retirée', 'Criticité métier', 'Élevée', 'Exposé à l\'extérieur', 'Oui', 'Non', 'Environnement', 'Pool de coûts']) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.queryByText('retired')).not.toBeInTheDocument();
  });

  it('names relation sections, document statuses and operational criticality as the screens do', () => {
    renderCard(preview({
      tool_name: 'update_entity_relations',
      target: { entity_type: 'applications', entity_id: 'app-1', ref: null, title: 'CheeseTrack' },
      changes: { contracts: { label: 'Contracts', from: null, to: 'Support Oracle', format: 'text' } },
    }));
    expect(screen.getByText('Contrats')).toBeInTheDocument();
    cleanup();

    renderCard(preview({
      tool_name: 'create_document',
      target: { entity_type: 'documents', entity_id: null, ref: null, title: 'Plan de reprise' },
      changes: { status: { label: 'Status', from: null, to: 'draft', format: 'text' } },
    }));
    expect(screen.getByText('Brouillon')).toBeInTheDocument();
    cleanup();

    renderCard(preview({
      tool_name: 'update_business_record',
      target: { entity_type: 'interfaces', entity_id: 'if-1', ref: 'IF-3', title: 'Flux paie' },
      changes: { criticality: { label: 'Operational criticality', from: null, to: 'Haute', format: 'text' } },
    }));
    expect(screen.getByText('Criticité opérationnelle')).toBeInTheDocument();
  });

  it('shows dates in the format of the screens, not as stored', () => {
    renderCard(preview({
      tool_name: 'update_task_fields',
      target: { entity_type: 'tasks', entity_id: 'task-1', ref: 'T-4', title: 'Migration' },
      changes: {
        due_date: { label: 'Due Date', from: '2031-01-01T00:00:00.000Z', to: '2031-11-03', format: 'text' },
      },
    }));

    expect(screen.getByText('1 janv. 2031')).toBeInTheDocument();
    expect(screen.getByText('3 nov. 2031')).toBeInTheDocument();
    expect(screen.queryByText('2031-11-03')).not.toBeInTheDocument();
  });

  // Intl separates thousands and the currency with no-break spaces: compare the visible words.
  const byText = (expected: string) => (_: string, element: Element | null) =>
    element?.tagName === 'P' && (element.textContent ?? '').replace(/[\u00a0\u202f]/g, ' ') === expected;

  it('writes budget amounts with the column names of the budget screens, in the language and currency', () => {
    renderCard(preview({
      tool_name: 'create_business_record',
      target: { entity_type: 'spend_items', entity_id: null, ref: null, title: 'Licences' },
      changes: {
        amounts: {
          label: 'Amounts',
          from: null,
          to: '2026 annual totals (Budget: 12000)',
          format: 'text',
          amounts: { from: null, to: { year: 2026, currency: 'EUR', column_names: {}, totals: { planned: 12000, expected_landing: 11500.5 } } },
        },
      },
    }));
    expect(screen.getByText('Montants')).toBeInTheDocument();
    expect(screen.getByText(byText('Budget 2026 : 12 000 €, Atterrissage prévu 2026 : 11 500,50 €'))).toBeInTheDocument();
    expect(screen.queryByText('2026 annual totals (Budget: 12000)')).not.toBeInTheDocument();
    cleanup();

    renderCard(preview({
      tool_name: 'write_financial_plan',
      target: { entity_type: 'spend_items', entity_id: 'line-1', ref: 'BL-7', title: 'Licences / Y2026' },
      changes: {
        amounts: {
          label: 'Amounts',
          from: '2026 totals (A0: 0)',
          to: '2026 quarterly A0 (Q1: 1000, Q2: 0, Q3: 0, Q4: 0)',
          format: 'text',
          amounts: {
            from: { year: 2026, currency: 'CHF', column_names: { planned: 'A0' }, totals: { planned: 0 } },
            to: { year: 2026, currency: 'CHF', column_names: { planned: 'A0' }, quarters: { measure: 'planned', values: { Q1: 1000, Q2: 0, Q3: 0, Q4: 0 } } },
          },
        },
      },
    }));
    expect(screen.getByText(byText('A0 2026 : 0 CHF'))).toBeInTheDocument();
    expect(screen.getByText(byText('A0 2026 : T1 1 000 CHF, T2 0 CHF, T3 0 CHF, T4 0 CHF'))).toBeInTheDocument();
  });
});
