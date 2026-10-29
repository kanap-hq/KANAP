import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import i18n from '../../i18n';
import { AiMutationPreview } from '../aiTypes';
import PreviewCard from './PreviewCard';
import ArtifactPreviewChip from './ArtifactPreviewChip';
import { getPreviewLabel } from '../utils/previewClassification';

vi.mock('../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({
    labelFor: (field: string, code?: string | null) => (
      field === 'lifecycleStatus' && code === 'retired' ? 'Retirée'
        : field === 'technologyFamily' && code === 'database' ? 'Base de données'
          : field === 'serverRole' && code === 'database' ? 'Base de données'
            : field === 'incidentCategories' && code === 'security' ? 'Sécurité'
              : field === 'incidentCategories' && code === 'infrastructure' ? 'Infrastructure'
                : String(code ?? '')
    ),
  }),
}));

// The tenant's catalogs as the API sends them: the shipped English levels and task types, which the
// screens show in the person's language.
const level = (code: string, label: string, rank: number) => ({ code, label, description: '', rank });
vi.mock('../../api', () => ({
  default: {
    get: vi.fn(async (url: string) => {
      if (url === '/applications/classification-catalog') {
        return {
          data: {
            businessCriticalityLevels: [level('business_critical', 'Critical', 4), level('medium', 'Moderate', 2), level('low', 'Low', 1)],
            cyberCriticalityLevels: [],
            dataClasses: [],
            recoveryWaves: [],
          },
        };
      }
      if (url === '/portfolio/classification/task-types') {
        return { data: [{ id: 'type-1', name: 'Task', code: 'task', description: 'Standard task or work item', is_active: true }] };
      }
      throw new Error(`Unexpected request ${url}`);
    }),
  },
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
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <PreviewCard preview={value} onApprove={() => undefined} onReject={() => undefined} />
      </ThemeProvider>
    </QueryClientProvider>,
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

  it('shows a deletion card with what goes with the record, in French', () => {
    renderCard(preview({
      tool_name: 'delete_record',
      target: { entity_type: 'tasks', entity_id: 'task-1', ref: 'T-42', title: 'T-42 - Migration' },
      summary: 'Suppression de la tâche « Migration ».',
      changes: {
        deletion: {
          label: 'What goes with it',
          from: null,
          to: '- Commentaires et changements : 2\n- Temps saisis : 1\n- Pièces jointes : 1\n- Liens aux applications : 1\n\nLes fiches liées restent.',
          format: 'markdown',
        },
      },
    }));

    expect(screen.getByText('Ce qui part avec la fiche')).toBeInTheDocument();
    for (const text of ['Commentaires et changements : 2', 'Temps saisis : 1', 'Pièces jointes : 1', 'Liens aux applications : 1', 'Les fiches liées restent.']) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByText('Suppression de la tâche « Migration ».')).toBeInTheDocument();
    expect(screen.queryByText('What goes with it')).not.toBeInTheDocument();
  });

  it('shows an incident closure with its status, category, date-time and warnings, in French', () => {
    renderCard(preview({
      tool_name: 'update_business_record',
      target: { entity_type: 'incidents', entity_id: 'incident-1', ref: 'INC-7', title: 'INC-7 - Mail outage' },
      summary: "Clôturé : modification de l'incident « INC-7 - Mail outage ».",
      changes: {
        title: { label: 'Title', from: 'Mail outage', to: 'Mail outage resolved', format: 'text' },
        status: { label: 'Status', from: 'open', to: 'closed', format: 'text' },
        severity: { label: 'Severity', from: 'major', to: 'minor', format: 'text' },
        category: { label: 'Category', from: 'infrastructure', to: 'security', format: 'text' },
        detected_at: { label: 'Detected', from: '2026-10-27T08:00:00.000Z', to: '2026-10-27T09:30:00.000Z', format: 'text' },
        closure_warning: {
          label: 'Closure',
          from: null,
          to: "Cette clôture fige l'incident : seul un administrateur pourra le rouvrir.",
          format: 'text',
        },
        access_warning: {
          label: 'Access',
          from: null,
          to: "Après cette modification, seuls les administrateurs du registre, le déclarant et le responsable pourront l'ouvrir. Vous serez renvoyé vers le registre.",
          format: 'text',
        },
      },
    }));

    expect(screen.getByText('Ouvert')).toBeInTheDocument();
    expect(screen.getByText('Clôturé')).toBeInTheDocument();
    expect(screen.getByText('Majeure')).toBeInTheDocument();
    expect(screen.getByText('Mineure')).toBeInTheDocument();
    expect(screen.getByText('Infrastructure')).toBeInTheDocument();
    expect(screen.getByText('Sécurité')).toBeInTheDocument();
    expect(screen.getByText('Titre')).toBeInTheDocument();
    expect(screen.getByText('Statut')).toBeInTheDocument();
    expect(screen.getByText('Gravité')).toBeInTheDocument();
    expect(screen.getByText('Catégorie')).toBeInTheDocument();
    expect(screen.getByText('Détecté')).toBeInTheDocument();
    expect(screen.getAllByText(/2026, \d{2}:\d{2}/)).toHaveLength(2);
    expect(screen.getByText("Cette clôture fige l'incident : seul un administrateur pourra le rouvrir.")).toBeInTheDocument();
    expect(screen.getByText("Après cette modification, seuls les administrateurs du registre, le déclarant et le responsable pourront l'ouvrir. Vous serez renvoyé vers le registre.")).toBeInTheDocument();
    expect(screen.getByText('Clôture')).toBeInTheDocument();
    expect(screen.getByText('Accès')).toBeInTheDocument();
  });

  it('shows an incident reopen with its before and after status and the reason, in French', () => {
    renderCard(preview({
      tool_name: 'change_incident_state',
      target: { entity_type: 'incidents', entity_id: 'incident-1', ref: 'INC-7', title: 'INC-7 - Mail outage' },
      summary: "Réouverture de l'incident « INC-7 - Mail outage ».",
      changes: {
        status: { label: 'Status', from: 'closed', to: 'in_progress', format: 'text' },
        reason: { label: 'Reason', from: null, to: 'Retour après correctif.', format: 'text' },
      },
    }));

    expect(screen.getByText('Statut')).toBeInTheDocument();
    expect(screen.getByText('Clôturé')).toBeInTheDocument();
    expect(screen.getByText('En cours')).toBeInTheDocument();
    expect(screen.getByText('Raison')).toBeInTheDocument();
    expect(screen.getByText('Retour après correctif.')).toBeInTheDocument();
    expect(screen.getByText("Réouverture de l'incident « INC-7 - Mail outage ».")).toBeInTheDocument();
  });

  it('shows an incident cancellation with the freeze warning, in French', () => {
    renderCard(preview({
      tool_name: 'change_incident_state',
      target: { entity_type: 'incidents', entity_id: 'incident-1', ref: 'INC-7', title: 'INC-7 - Mail outage' },
      summary: "Annulation de l'incident « INC-7 - Mail outage ».",
      changes: {
        status: { label: 'Status', from: 'open', to: 'cancelled', format: 'text' },
        reason: { label: 'Reason', from: null, to: 'Doublon de INC-6.', format: 'text' },
        cancel_warning: {
          label: 'Cancellation',
          from: null,
          to: "Cette annulation fige l'incident : seul un administrateur pourra le rouvrir.",
          format: 'text',
        },
      },
    }));

    expect(screen.getByText('Ouvert')).toBeInTheDocument();
    expect(screen.getByText('Annulé')).toBeInTheDocument();
    expect(screen.getByText('Doublon de INC-6.')).toBeInTheDocument();
    expect(screen.getByText("Cette annulation fige l'incident : seul un administrateur pourra le rouvrir.")).toBeInTheDocument();
    expect(screen.getByText('Annulation')).toBeInTheDocument();
  });

  it('shows an incident confidentiality lifted, in French', () => {
    renderCard(preview({
      tool_name: 'set_incident_confidentiality',
      target: { entity_type: 'incidents', entity_id: 'incident-1', ref: 'INC-7', title: 'INC-7 - Mail outage' },
      summary: "Levée de la confidentialité de l'incident « INC-7 - Mail outage ».",
      changes: {
        confidential: { label: 'Confidential', from: 'Yes', to: 'No', format: 'text' },
      },
    }));

    expect(screen.getByText('Restreindre aux administrateurs du registre')).toBeInTheDocument();
    expect(screen.getByText('Oui')).toBeInTheDocument();
    expect(screen.getByText('Non')).toBeInTheDocument();
    expect(screen.getByText("Levée de la confidentialité de l'incident « INC-7 - Mail outage ».")).toBeInTheDocument();
  });

  it('shows an incident note with its text and event time, in French', () => {
    renderCard(preview({
      tool_name: 'add_incident_note',
      target: { entity_type: 'incidents', entity_id: 'incident-1', ref: 'INC-7', title: 'INC-7 - Mail outage' },
      summary: "Ajout d'une note à l'incident « INC-7 - Mail outage ».",
      changes: {
        note: { label: 'Note', from: null, to: 'Mail is back.\nFailover to the secondary site done.', format: 'markdown' },
        occurred_at: { label: "Date de l'événement", from: null, to: '2026-10-28T14:00:00.000Z', format: 'text' },
      },
    }));

    expect(screen.getByText('Note')).toBeInTheDocument();
    expect(screen.getByText(/Mail is back\./)).toBeInTheDocument();
    expect(screen.getByText(/Failover to the secondary site done\./)).toBeInTheDocument();
    expect(screen.getByText("Date de l'événement")).toBeInTheDocument();
    expect(screen.getByText(/2026, \d{2}:\d{2}/)).toBeInTheDocument();
    expect(screen.getByText("Ajout d'une note à l'incident « INC-7 - Mail outage ».")).toBeInTheDocument();
  });

  it('shows the incident links added, removed and already present, in French', () => {
    renderCard(preview({
      tool_name: 'update_incident_links',
      target: { entity_type: 'incidents', entity_id: 'incident-1', ref: 'INC-7', title: 'INC-7 - Mail outage' },
      summary: "Modification des liens de l'incident « INC-7 - Mail outage ».",
      changes: {
        linked_assets: { label: 'Linked assets', from: null, to: '**Ajoutés**\n- AST-12 - PAR-ESX-01', format: 'markdown' },
        linked_applications: { label: 'Linked applications', from: null, to: '**Retirés**\n- APP-2 - Mail', format: 'markdown' },
        linked_technologies: { label: 'Linked technologies', from: null, to: '**Déjà liés**\n- TEC-3 - PostgreSQL', format: 'markdown' },
      },
    }));

    expect(screen.getByText('Actifs liés')).toBeInTheDocument();
    expect(screen.getByText('Applications liées')).toBeInTheDocument();
    expect(screen.getByText('Technologies liées')).toBeInTheDocument();
    expect(screen.getByText('Ajoutés')).toBeInTheDocument();
    expect(screen.getByText('Retirés')).toBeInTheDocument();
    expect(screen.getByText('Déjà liés')).toBeInTheDocument();
    for (const text of ['AST-12 - PAR-ESX-01', 'APP-2 - Mail', 'TEC-3 - PostgreSQL']) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByText("Modification des liens de l'incident « INC-7 - Mail outage ».")).toBeInTheDocument();
  });

  it('shows the technology links with their applications and servers, in French', () => {
    renderCard(preview({
      tool_name: 'update_technology_links',
      target: { entity_type: 'technologies', entity_id: 'tec-1', ref: 'TEC-1', title: 'TEC-1 - PostgreSQL' },
      summary: 'Modification des liens de « TEC-1 - PostgreSQL ».',
      changes: {
        technology_applications: {
          label: 'Applications',
          from: null,
          to: '**Ajoutés**\n- APP-36 - CheeseTrack: PostgreSQL 16 (existante, fin de support 2028-11-09)',
          format: 'markdown',
        },
        technology_servers: {
          label: 'Servers',
          from: null,
          to: '**Ajoutés**\n- AST-12 - srv-db-01 (nouvelle version 16, sans date de support)',
          format: 'markdown',
        },
        technology_versions: {
          label: 'Versions',
          from: null,
          to: "**Conservées**\n- nouvelle version 17, sans date de support (l'annulation retire les liens, pas la version)",
          format: 'markdown',
        },
      },
    }));

    expect(screen.getByText('Applications')).toBeInTheDocument();
    expect(screen.getByText('Serveurs')).toBeInTheDocument();
    expect(screen.getByText('Versions')).toBeInTheDocument();
    expect(screen.getByText('Conservées')).toBeInTheDocument();
    expect(screen.getAllByText('Ajoutés')).toHaveLength(2);
    expect(screen.getByText(/APP-36 - CheeseTrack/)).toBeInTheDocument();
    expect(screen.getByText(/AST-12 - srv-db-01/)).toBeInTheDocument();
    expect(screen.getByText('Modification des liens de « TEC-1 - PostgreSQL ».')).toBeInTheDocument();
  });

  it('shows a technology adoption and a versions change, in French', () => {
    renderCard(preview({
      tool_name: 'update_technology_versions',
      target: { entity_type: 'technologies', entity_id: 'tec-1', ref: 'TEC-1', title: 'TEC-1 - PostgreSQL' },
      summary: 'Modification des versions de « TEC-1 - PostgreSQL ».',
      changes: {
        technology_versions: {
          label: 'Versions',
          from: null,
          to: '**Conservées**\n- nouvelle version 17 (l\'annulation restaure les versions modifiées, pas la nouvelle)',
          format: 'markdown',
        },
      },
    }));
    expect(screen.getByText('Versions')).toBeInTheDocument();
    expect(screen.getByText('Conservées')).toBeInTheDocument();
    expect(screen.getByText(/nouvelle version 17/)).toBeInTheDocument();

    renderCard(preview({
      tool_name: 'create_business_record',
      target: { entity_type: 'technologies', entity_id: null, ref: null, title: 'PostgreSQL' },
      summary: 'Adoption de « PostgreSQL » depuis le catalogue KANAP.',
      changes: {
        catalog_adoption: {
          label: 'KANAP catalog',
          from: null,
          to: '**Adoptée du catalogue KANAP**\n- 12 versions, fin de support de 2017-01-01 à 2032-12-31',
          format: 'markdown',
        },
        family: { label: 'Family', from: null, to: 'database', format: 'text' },
      },
    }));
    expect(screen.getAllByText('Catalogue KANAP').length).toBeGreaterThan(0);
    expect(screen.getByText(/Adoptée du catalogue KANAP/)).toBeInTheDocument();
    // The family code reads as the screen shows it, in French.
    expect(screen.getByText('Famille')).toBeInTheDocument();
    expect(screen.getByText('Base de données')).toBeInTheDocument();
  });

  it('shows the technology people, web links and vulnerability alerts, in French', () => {
    renderCard(preview({
      tool_name: 'update_technology_people',
      target: { entity_type: 'technologies', entity_id: 'tec-1', ref: 'TEC-1', title: 'TEC-1 - PostgreSQL' },
      summary: 'Modification des responsables et contacts de « TEC-1 - PostgreSQL ».',
      changes: {
        technology_owners: {
          label: 'Owners',
          from: null,
          to: '**Ajoutés**\n- Paul Martin (responsable IT)',
          format: 'markdown',
        },
        technology_support_contacts: {
          label: 'Support contacts',
          from: null,
          to: '**Ajoutés**\n- Oracle Support (rôle : Support)',
          format: 'markdown',
        },
      },
    }));
    expect(screen.getByText('Responsables')).toBeInTheDocument();
    expect(screen.getByText('Contacts de support')).toBeInTheDocument();
    expect(screen.getByText('Paul Martin (responsable IT)')).toBeInTheDocument();
    expect(screen.getByText('Oracle Support (rôle : Support)')).toBeInTheDocument();

    renderCard(preview({
      tool_name: 'update_technology_web_links',
      target: { entity_type: 'technologies', entity_id: 'tec-1', ref: 'TEC-1', title: 'TEC-1 - PostgreSQL' },
      summary: 'Modification des liens web de « TEC-1 - PostgreSQL ».',
      changes: {
        technology_web_links: {
          label: 'Web links',
          from: null,
          to: '**Ajoutés**\n- https://example.com/runbook (Runbook)',
          format: 'markdown',
        },
      },
    }));
    expect(screen.getByText('Liens web')).toBeInTheDocument();
    expect(screen.getByText(/example\.com\/runbook/)).toBeInTheDocument();
    expect(screen.getByText(/Runbook/)).toBeInTheDocument();

    renderCard(preview({
      tool_name: 'set_technology_vulnerability_alerts',
      target: { entity_type: 'technologies', entity_id: 'tec-1', ref: 'TEC-1', title: 'TEC-1 - PostgreSQL' },
      summary: 'Modification des alertes de vulnérabilité de « TEC-1 - PostgreSQL ».',
      changes: {
        technology_vulnerability_alerts: {
          label: 'Vulnerability alerts',
          from: null,
          to: '- désactivées\n- 2 exceptions de version seront effacées : 14, 16',
          format: 'markdown',
        },
      },
    }));
    expect(screen.getAllByText('Alertes de vulnérabilité').length).toBeGreaterThan(0);
    expect(screen.getByText('désactivées')).toBeInTheDocument();
    expect(screen.getByText('2 exceptions de version seront effacées : 14, 16')).toBeInTheDocument();
  });

  it('shows the state change of vulnerability rows and its undo, in French', () => {
    renderCard(preview({
      tool_name: 'change_vulnerability_state',
      target: { entity_type: 'vulnerabilities', entity_id: null, ref: null, title: '2 CVE' },
      summary: "Passage de 3 lignes de vulnérabilités à l'état « Traitée ».",
      changes: {
        vulnerability_state: {
          label: 'Vulnerability state',
          from: null,
          to: [
            '3 lignes sur 5 (2 CVE) : À traiter → Traitée',
            'Note : « Corrigé en 14.2 »',
            '- CVE-2024-1111 sur TEC-3 PostgreSQL 14\n- et 2 autres',
            '1 est hors des alertes de vulnérabilité',
          ].join('\n\n'),
          format: 'markdown',
        },
      },
    }));
    expect(screen.getAllByText('État de la vulnérabilité').length).toBeGreaterThan(0);
    expect(screen.getByText('3 lignes sur 5 (2 CVE) : À traiter → Traitée')).toBeInTheDocument();
    expect(screen.getByText('Note : « Corrigé en 14.2 »')).toBeInTheDocument();
    expect(screen.getByText('CVE-2024-1111 sur TEC-3 PostgreSQL 14')).toBeInTheDocument();
    expect(screen.getByText('et 2 autres')).toBeInTheDocument();
    expect(screen.getByText('1 est hors des alertes de vulnérabilité')).toBeInTheDocument();

    renderCard(preview({
      tool_name: 'change_vulnerability_state',
      target: { entity_type: 'vulnerabilities', entity_id: null, ref: null, title: '2 CVE' },
      summary: 'Retour de 3 lignes de vulnérabilités à leur état précédent.',
      changes: {
        vulnerability_state: {
          label: 'Vulnerability state',
          from: null,
          to: [
            '3 lignes (2 CVE) : Traitée → retour à leur état précédent',
            "- 2 lignes reviendront à l'état À traiter, note effacée\n- 1 ligne reviendra à l'état Non concernée",
          ].join('\n\n'),
          format: 'markdown',
        },
      },
    }));
    expect(screen.getByText('3 lignes (2 CVE) : Traitée → retour à leur état précédent')).toBeInTheDocument();
    expect(screen.getByText("2 lignes reviendront à l'état À traiter, note effacée")).toBeInTheDocument();
    expect(screen.getByText("1 ligne reviendra à l'état Non concernée")).toBeInTheDocument();
  });

  it('shows a budget line deletion with its versions, tasks and links, in French', () => {
    renderCard(preview({
      tool_name: 'delete_record',
      target: { entity_type: 'budget_lines', entity_id: 'line-1', ref: 'BL-12', title: 'ERP licence' },
      summary: 'Suppression de la ligne OPEX « ERP licence ».',
      changes: {
        deletion: {
          label: 'What goes with it',
          from: null,
          to: [
            '- Versions avec des montants : 2',
            '- Années avec des montants : 2',
            '- Tâches supprimées : 1',
            "- Demandes qui perdent leur tâche d'origine : 1",
            '- Pièces jointes : 1',
            '- Liens aux contrats : 1',
            '- Liens aux projets : 1',
            '- Liens aux demandes : 1',
            '- Liens aux applications : 1',
            '- Liens aux actifs : 1',
            '- Liens aux technologies : 1',
            '- Liens aux contacts : 1',
            '- Liens : 1',
            '- Valeurs de dimensions : 1',
            '',
            'Les fiches liées restent.',
          ].join('\n'),
          format: 'markdown',
        },
      },
    }));

    expect(screen.getByText('Ce qui part avec la fiche')).toBeInTheDocument();
    for (const text of [
      'Versions avec des montants : 2',
      'Années avec des montants : 2',
      'Tâches supprimées : 1',
      "Demandes qui perdent leur tâche d'origine : 1",
      'Pièces jointes : 1',
      'Liens aux contrats : 1',
      'Liens aux projets : 1',
      'Liens aux demandes : 1',
      'Liens aux applications : 1',
      'Liens aux actifs : 1',
      'Liens aux technologies : 1',
      'Liens aux contacts : 1',
      'Liens : 1',
      'Valeurs de dimensions : 1',
      'Les fiches liées restent.',
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByText('Suppression de la ligne OPEX « ERP licence ».')).toBeInTheDocument();
  });

  it('shows an interface deletion with its bindings and documents, in French', () => {
    renderCard(preview({
      tool_name: 'delete_record',
      target: { entity_type: 'interfaces', entity_id: 'iface-1', ref: 'INT-7', title: 'INT-7 - Orders' },
      summary: "Suppression de l'interface « INT-7 - Orders ».",
      changes: {
        deletion: {
          label: 'What goes with it',
          from: null,
          to: [
            '- Liaisons : 2',
            '- Liens aux connexions : 2',
            '- Documents intégrés : 1',
            '- Liens aux documents : 1',
            '- Liens aux interfaces dépendantes : 1',
            '- Pièces jointes : 1',
            '- Liens aux applications : 2',
            '',
            'Les connexions sont conservées.',
          ].join('\n'),
          format: 'markdown',
        },
      },
    }));

    expect(screen.getByText('Ce qui part avec la fiche')).toBeInTheDocument();
    for (const text of [
      'Liaisons : 2',
      'Liens aux connexions : 2',
      'Documents intégrés : 1',
      'Liens aux documents : 1',
      'Liens aux interfaces dépendantes : 1',
      'Pièces jointes : 1',
      'Liens aux applications : 2',
      'Les connexions sont conservées.',
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByText("Suppression de l'interface « INT-7 - Orders ».")).toBeInTheDocument();
  });

  it('shows a document deletion with its versions, links and review notice, in French', () => {
    renderCard(preview({
      tool_name: 'delete_record',
      target: { entity_type: 'documents', entity_id: 'doc-12', ref: 'DOC-12', title: 'Runbook' },
      summary: 'Suppression du document « Runbook ».',
      changes: {
        deletion: {
          label: 'What goes with it',
          from: null,
          to: [
            '- Versions : 2',
            '- Pièces jointes : 1',
            "- Documents qui le citent : 1",
            "- Documents qu'il cite : 1",
            '- Liens aux applications : 1',
            '- Documents créés depuis ce modèle : 1',
            '- En cours de relecture. La suppression reste possible.',
            '- Verrouillé pour édition par Camille Roux. La suppression reste possible.',
            '',
            'Les fiches liées restent.',
          ].join('\n'),
          format: 'markdown',
        },
      },
    }));

    expect(screen.getByText('Ce qui part avec la fiche')).toBeInTheDocument();
    for (const text of [
      'Versions : 2',
      'Pièces jointes : 1',
      'Documents qui le citent : 1',
      "Documents qu'il cite : 1",
      'Liens aux applications : 1',
      'Documents créés depuis ce modèle : 1',
      'En cours de relecture. La suppression reste possible.',
      'Verrouillé pour édition par Camille Roux. La suppression reste possible.',
      'Les fiches liées restent.',
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByText('Suppression du document « Runbook ».')).toBeInTheDocument();
  });

  it('shows the reference of a connection once when the server label repeats it', () => {
    renderCard(preview({
      tool_name: 'delete_record',
      target: { entity_type: 'connections', entity_id: 'conn-1', ref: 'CON-1', title: 'CON-1 - CON-1 - DB link' },
      summary: 'Suppression de la connexion « DB link ».',
      changes: {
        deletion: { label: 'What goes with it', from: null, to: '- Sauts : 1', format: 'markdown' },
      },
    }));

    expect(screen.getByText('CON-1')).toBeInTheDocument();
    expect(screen.getByText('DB link')).toBeInTheDocument();
    expect(screen.queryByText(/CON-1 - CON-1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/CON-1 - DB link/)).not.toBeInTheDocument();
  });

  it('shows a task creation with the labels and values of the task screens', async () => {
    renderCard(preview({
      summary: 'Création de la tâche autonome « Migration ». Priorité : Moyenne.',
      changes: {
        relation: { label: 'Relation', from: null, to: 'Standalone', format: 'text' },
        title: { label: 'Title', from: null, to: 'Migration', format: 'text' },
        assignee: { label: 'Assignee', from: null, to: 'Marie Durand', format: 'text' },
        priority: { label: 'Priority', from: null, to: 'Normal', format: 'text' },
        status: { label: 'Status', from: null, to: 'Open', format: 'text' },
        due_date: { label: 'Due Date', from: null, to: null, format: 'text' },
        task_type: { label: 'Task Type', from: null, to: 'Task', format: 'text' },
      },
    }));

    // The task type reads as the tenant's types are shown, once they are loaded.
    expect(await screen.findByText('Tâche')).toBeInTheDocument();
    for (const text of ['Lié à', 'Autonome', 'Titre de la tâche', 'Assigné à', 'Priorité', 'Moyenne', 'Statut', 'Ouvert', 'Échéance', 'Type de tâche']) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    for (const text of ['Rattachement', 'Responsable', 'Task']) {
      expect(screen.queryByText(text)).not.toBeInTheDocument();
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
        external_facing: { label: 'External Facing', from: 'No', to: 'Yes', format: 'text' },
        environment: { label: 'Environment', from: null, to: 'pre_prod', format: 'text' },
        'analytics_axis:pool': { label: 'Pool de coûts', from: null, to: 'Infra', format: 'text' },
      },
    }));

    for (const text of ['Cycle de vie', 'Retirée', 'Exposition externe', 'Oui', 'Non', 'Environnement', 'Pool de coûts']) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.queryByText('retired')).not.toBeInTheDocument();
  });

  it('names a criticality level as the application screen does, from the tenant catalog', async () => {
    renderCard(preview({
      tool_name: 'update_business_record',
      target: { entity_type: 'applications', entity_id: 'app-1', ref: 'APP-36', title: 'CheeseTrack' },
      changes: {
        criticality: {
          label: 'Business criticality',
          from: 'Critical',
          to: 'Low',
          format: 'text',
          classification: { catalog: 'businessCriticalityLevels', from: 'business_critical', to: 'low' },
        },
      },
    }));

    expect(await screen.findByText('Critique')).toBeInTheDocument();
    expect(screen.getByText('Faible')).toBeInTheDocument();
    expect(screen.getByText('Criticité business')).toBeInTheDocument();
    for (const text of ['Critical', 'Low', 'Criticité métier']) {
      expect(screen.queryByText(text)).not.toBeInTheDocument();
    }
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
    expect(screen.getByText('Criticité')).toBeInTheDocument();
  });

  it('names the fields of a budget line as the budget line screen does', () => {
    renderCard(preview({
      tool_name: 'create_business_record',
      target: { entity_type: 'budget_lines', entity_id: null, ref: null, title: 'QA-PL montant' },
      changes: {
        nature: { label: 'Nature', from: null, to: 'capex', format: 'text' },
        product_name: { label: 'Product Name', from: null, to: 'QA-PL montant', format: 'text' },
        paying_company_id: { label: 'Paying Company', from: null, to: 'Fromage & Co SA', format: 'text' },
        account_id: { label: 'Account', from: null, to: '612100 - SaaS Subscriptions', format: 'text' },
        currency: { label: 'Currency', from: null, to: 'EUR', format: 'text' },
        effective_start: { label: 'Effective Start', from: null, to: '2026-01-01', format: 'text' },
        owner_it_id: { label: 'IT Owner', from: null, to: 'Marie Durand', format: 'text' },
        run_build: { label: 'Run or build', from: null, to: 'run', format: 'text' },
      },
    }));

    for (const text of ['Type de ligne', 'CAPEX', 'Nom du produit', 'Société payeuse', 'Compte', 'Devise', 'Début d\'effet', 'Responsable IT', 'Run ou build']) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.queryByText('Début de validité')).not.toBeInTheDocument();
    // The fields keep the order the server sends, which no longer depends on how the preview was stored.
    const labels = ['Type de ligne', 'Nom du produit', 'Société payeuse', 'Compte', 'Devise', 'Début d\'effet'].map((text) => screen.getByText(text));
    labels.slice(1).forEach((label, index) => {
      expect(labels[index].compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
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
      target: { entity_type: 'budget_lines', entity_id: null, ref: null, title: 'Licences' },
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
      target: { entity_type: 'budget_lines', entity_id: 'line-1', ref: 'BL-7', title: 'Licences / Y2026' },
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

  it('shows the reference of the target once, in the card, its tab and its chip', () => {
    const app = preview({
      tool_name: 'update_business_record',
      target: { entity_type: 'applications', entity_id: 'app-36', ref: 'APP-36', title: 'APP-36 - CheeseTrack' },
      changes: { version: { label: 'Version', from: '4.1', to: '4.2', format: 'text' } },
    });
    renderCard(app);
    expect(screen.getByText('APP-36')).toBeInTheDocument();
    expect(screen.getByText('CheeseTrack')).toBeInTheDocument();
    expect(screen.queryByText(/APP-36 - CheeseTrack/)).not.toBeInTheDocument();
    cleanup();

    const project = preview({
      tool_name: 'update_business_record',
      target: { entity_type: 'projects', entity_id: 'prj-2', ref: 'PRJ-2', title: "PRJ-2 - Suivi connecté de l'affinage" },
    });
    expect(getPreviewLabel(project)).toBe("PRJ-2 · Suivi connecté de l'affinage");
    expect(getPreviewLabel(preview({ target: { entity_type: 'tasks', entity_id: 't', ref: 'T-4', title: 'T-4' } }))).toBe('T-4');
    // A reference that only starts like the title's is not cut out of it.
    expect(getPreviewLabel(preview({ target: { entity_type: 'applications', entity_id: 'a', ref: 'APP-3', title: 'APP-36 - CheeseTrack' } })))
      .toBe('APP-3 · APP-36 - CheeseTrack');

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={createAppTheme('light')}>
          <ArtifactPreviewChip preview={project} onOpen={() => undefined} />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText('Ouvrir dans le panneau')).toBeInTheDocument();
    expect(screen.getByText("PRJ-2 · Suivi connecté de l'affinage")).toBeInTheDocument();
  });

  it('names the roles of a relation as the screens do', () => {
    renderCard(preview({
      tool_name: 'update_entity_relations',
      target: { entity_type: 'applications', entity_id: 'app-36', ref: 'APP-36', title: 'APP-36 - CheeseTrack' },
      changes: {
        owners: {
          label: 'Owners',
          from: 'BUSINESS owner: Thomas Berger',
          to: 'BUSINESS owner: Thomas Berger, IT owner: Claire Martin',
          format: 'text',
          relation_items: {
            from: [{ name: 'Thomas Berger', role: { kind: 'owner', code: 'business' } }],
            to: [
              { name: 'Thomas Berger', role: { kind: 'owner', code: 'business' } },
              { name: 'Claire Martin', role: { kind: 'owner', code: 'it' } },
            ],
          },
        },
        support_contacts: {
          label: 'Support Contacts',
          from: null,
          to: 'Marc Dubois - Astreinte',
          format: 'text',
          relation_items: { from: [], to: [{ name: 'Marc Dubois', role: { kind: 'text', code: 'Astreinte' } }] },
        },
        asset_assignments: {
          label: 'Asset Assignments',
          from: null,
          to: 'pre_prod: SRV-DB-01 (database)',
          format: 'text',
          relation_items: { from: [], to: [{ name: 'SRV-DB-01', role: { kind: 'server_role', code: 'database' }, environment: 'pre_prod' }] },
        },
      },
    }));
    expect(screen.getByText(byText('Responsable métier : Thomas Berger'))).toBeInTheDocument();
    expect(screen.getByText(byText('Responsable métier : Thomas Berger, Responsable IT : Claire Martin'))).toBeInTheDocument();
    expect(screen.getByText(byText('Marc Dubois (Astreinte)'))).toBeInTheDocument();
    expect(screen.getByText(byText('Pré-prod : SRV-DB-01 (Base de données)'))).toBeInTheDocument();
    cleanup();

    renderCard(preview({
      tool_name: 'update_entity_relations',
      target: { entity_type: 'assets', entity_id: 'ast-1', ref: 'AST-1', title: 'Cluster SQL' },
      changes: {
        relations: {
          label: 'Asset Relations',
          from: null,
          to: 'contains: SRV-DB-01, depends_on: SAN-01',
          format: 'text',
          relation_items: {
            from: [],
            to: [
              { name: 'SRV-DB-01', role: { kind: 'asset_relation', code: 'contains' } },
              { name: 'SAN-01', role: { kind: 'asset_relation', code: 'depends_on' } },
            ],
          },
        },
        replaced_host_links: {
          label: 'Host links replaced',
          from: 'ESX-01 contains SRV-DB-01',
          to: null,
          format: 'text',
          relation_items: { from: [{ name: 'SRV-DB-01', role: null, host: 'ESX-01' }], to: [] },
        },
      },
    }));
    expect(screen.getByText(byText('Contient : SRV-DB-01, Dépend de : SAN-01'))).toBeInTheDocument();
    expect(screen.getByText(byText('ESX-01 contient SRV-DB-01'))).toBeInTheDocument();
    cleanup();

    renderCard(preview({
      tool_name: 'update_entity_relations',
      target: { entity_type: 'suppliers', entity_id: 'sup-1', ref: null, title: 'Oracle' },
      changes: {
        contacts: {
          label: 'Contacts',
          from: null,
          to: 'Marc Dubois - technical',
          format: 'text',
          relation_items: { from: [], to: [{ name: 'Marc Dubois', role: { kind: 'contact', code: 'technical' } }] },
        },
      },
    }));
    expect(screen.getByText(byText('Marc Dubois (Technique)'))).toBeInTheDocument();
    for (const english of [/owner/, /depends_on/, /contains/, /technical/]) {
      expect(screen.queryByText(english)).not.toBeInTheDocument();
    }
  });

  it('says that a change failed in the language of the person, the message of the service as detail', () => {
    renderCard(preview({
      tool_name: 'create_document',
      status: 'failed',
      target: { entity_type: 'documents', entity_id: null, ref: null, title: 'Plan de reprise' },
      error_message: 'Library not found',
      error_is_technical: true,
    }));
    expect(screen.getByText("La modification n'a pas été faite.")).toBeInTheDocument();
    expect(screen.getByText('Library not found')).toBeInTheDocument();
    cleanup();

    // A refused right keeps its message, as the limits of Plaid write it.
    const refusal = 'You need the right to modify knowledge documents, which your role does not give. An administrator can add it to your role.';
    renderCard(preview({
      tool_name: 'create_document',
      status: 'failed',
      target: { entity_type: 'documents', entity_id: null, ref: null, title: 'Plan de reprise' },
      error_message: refusal,
      error_is_technical: false,
    }));
    expect(screen.getByText(refusal)).toBeInTheDocument();
    expect(screen.queryByText("La modification n'a pas été faite.")).not.toBeInTheDocument();
  });
});
