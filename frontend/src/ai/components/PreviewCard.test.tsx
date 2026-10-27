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
});
