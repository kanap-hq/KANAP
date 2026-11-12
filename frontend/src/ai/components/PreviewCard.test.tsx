import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import i18n from '../../i18n';
import { AiMutationPreview } from '../aiTypes';
import PreviewCard from './PreviewCard';
import ArtifactPreviewChip from './ArtifactPreviewChip';
import { getPreviewLabel } from '../utils/previewClassification';
import { downloadServerExport } from '../../components/csv/serverExport';
import { PRODUCT_NAME } from '../../config/product';

vi.mock('../../components/csv/serverExport', () => ({ downloadServerExport: vi.fn(async () => undefined) }));

// The rights of the signed-in person: a budget line opens from the card when they may read budget lines.
let readableResources: string[] = ['budget'];
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: (resource: string) => readableResources.includes(resource) }),
}));

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
      summary: `Adoption de « PostgreSQL » depuis le catalogue ${PRODUCT_NAME}.`,
      changes: {
        catalog_adoption: {
          label: `${PRODUCT_NAME} catalog`,
          from: null,
          to: `**Adoptée du catalogue ${PRODUCT_NAME}**\n- 12 versions, fin de support de 2017-01-01 à 2032-12-31`,
          format: 'markdown',
        },
        family: { label: 'Family', from: null, to: 'database', format: 'text' },
      },
    }));
    expect(screen.getAllByText(`Catalogue ${PRODUCT_NAME}`).length).toBeGreaterThan(0);
    expect(screen.getByText(new RegExp(`Adoptée du catalogue ${PRODUCT_NAME}`))).toBeInTheDocument();
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

  it('shows the column mapping of an attached spreadsheet, in French', () => {
    renderCard(preview({
      tool_name: 'prepare_import_mapping',
      target: { entity_type: 'imports', entity_id: null, ref: null, title: 'Applications · export appli.csv' },
      summary: "Correspondance de « export appli.csv » avec l'import Applications.",
      import_mapping: {
        import_key: 'applications',
        filename: 'export appli.csv',
        row_count: 3,
        columns: [
          { column: 'name', title: 'Nom', required: true, kind: 'text', source: { position: 1, header: 'Appli' }, value: null, confidence: 'high', filled: 2, unread: 0, read_as: null, note: null },
          { column: 'lifecycle', title: 'Cycle de vie', required: false, kind: 'catalog', source: { position: 2, header: 'Etat' }, value: null, confidence: 'medium', filled: 3, unread: 1, read_as: null, note: 'Etat lu comme cycle de vie' },
          { column: 'go_live_date', title: 'Mise en service', required: false, kind: 'date', source: { position: 3, header: 'Mise en service' }, value: null, confidence: 'low', filled: 3, unread: 0, read_as: 'day-first', note: null },
          { column: 'end_of_support_date', title: 'Fin de support', required: false, kind: 'date', source: { position: 5, header: 'Fin' }, value: null, confidence: 'low', filled: 2, unread: 2, read_as: null, note: null },
          { column: 'category', title: 'Catégorie', required: false, kind: 'catalog', source: null, value: 'Métier', confidence: 'low', filled: 3, unread: 0, read_as: null, note: null },
        ],
        unread_values: { lifecycle: ['En prod'] },
        read_errors: { end_of_support_date: 'mixed-date-orders' },
        missing_required: [],
        unplaced: [{ position: 4, header: 'Commentaire interne' }],
        assumptions: ['Une ligne par application.'],
        sample: {
          columns: ['name', 'lifecycle', 'go_live_date', 'end_of_support_date', 'category'],
          rows: [['CheeseTrack', 'Actif', '2024-04-03', '', 'Métier'], ['CaveGuard', 'En prod', '2025-11-25', '', 'Métier']],
          unread: [[false, false, false, false, false], [false, true, false, false, false]],
        },
        rows_missing_required: 1,
      },
    }));

    expect(screen.getByText('Applications · export appli.csv')).toBeInTheDocument();
    for (const text of ['Colonne', 'Dans le fichier', 'Confiance', 'Valeurs', 'Appli', 'Etat lu comme cycle de vie', 'Moyenne', 'Jour en premier']) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    // What the import will not read, and why a whole column reads nothing.
    expect(screen.getByText('1 non lue')).toBeInTheDocument();
    expect(screen.getByText('(En prod)')).toBeInTheDocument();
    expect(screen.getByText('Dates écrites jour en premier et mois en premier')).toBeInTheDocument();
    expect(screen.getByText(/^Même valeur sur chaque ligne\s: Métier$/)).toBeInTheDocument();
    expect(screen.getByText("1 ligne n'a pas de valeur obligatoire.")).toBeInTheDocument();
    expect(screen.getByText(/^Non utilisées\s: Commentaire interne$/)).toBeInTheDocument();
    expect(screen.getByText('Une ligne par application.')).toBeInTheDocument();
    // The first rows: a date as on the screens, a value not read as the file writes it.
    expect(screen.getByText('Premières lignes')).toBeInTheDocument();
    expect(screen.getByText('3 avr. 2024')).toBeInTheDocument();
    expect(screen.getAllByText('En prod').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Approuver' })).toBeInTheDocument();
  });

  it('shows a date and time of the mapping as the file writes it', () => {
    renderCard(preview({
      tool_name: 'prepare_import_mapping',
      target: { entity_type: 'imports', entity_id: null, ref: null, title: 'Incidents · glpi.csv' },
      summary: "Correspondance de « glpi.csv » avec l'import Incidents.",
      import_mapping: {
        import_key: 'incidents',
        filename: 'glpi.csv',
        row_count: 1,
        columns: [
          { column: 'detected_at', title: 'Détecté le', required: false, kind: 'datetime', source: { position: 4, header: "Date d'ouverture" }, value: null, confidence: 'high', filled: 1, unread: 0, read_as: 'day-first', note: null },
        ],
        unread_values: {},
        read_errors: {},
        missing_required: [],
        unplaced: [],
        assumptions: [],
        sample: { columns: ['detected_at'], rows: [['2026-10-02 07:48']], unread: [[false]] },
        rows_missing_required: 0,
      },
    }));

    expect(screen.getByText('2 oct. 2026, 07:48')).toBeInTheDocument();
  });

  const importMapping = (over: Partial<NonNullable<AiMutationPreview['import_mapping']>>): NonNullable<AiMutationPreview['import_mapping']> => ({
    import_key: 'suppliers',
    filename: 'fournisseurs.xlsx',
    row_count: 3,
    columns: [
      { column: 'name', title: 'Nom', required: true, kind: 'text', source: { position: 1, header: 'Fournisseur' }, value: null, confidence: 'high', filled: 3, unread: 0, read_as: null, note: null },
      { column: 'erp_supplier_id', title: 'ID fournisseur ERP', required: false, kind: 'text', source: { position: 2, header: 'Code' }, value: null, confidence: 'high', filled: 3, unread: 0, read_as: null, note: null },
    ],
    unread_values: {},
    read_errors: {},
    missing_required: [],
    unplaced: [],
    assumptions: [],
    sample: { columns: ['name'], rows: [['Lactalis']], unread: [[false]] },
    rows_missing_required: 0,
    ...over,
  });

  it('shows the import check of a refused file and cannot be approved, in French', () => {
    renderCard(preview({
      tool_name: 'prepare_import_mapping',
      target: { entity_type: 'imports', entity_id: null, ref: null, title: 'Fournisseurs · fournisseurs.xlsx' },
      import_mapping: importMapping({
        validation: {
          ok: false, dry_run: true, total: 3, inserted: 2, updated: 1, unchanged: 0, skipped: 0, error_count: 12, warning_count: 1,
          report: {
            kind: 'rows',
            errors: [
              { row: 0, message: 'clears', code: 'AI_IMPORT_CLEARS_COLUMNS', params: { count: 1, columns: 'Notes, Statut' } },
              { row: 6, column: 'erp_supplier_id', message: 'ERP id too long' },
            ],
            warnings: [{ row: 4, column: 'name', message: 'Matched "SAVENCIA" to "Savencia"' }],
          },
        },
      }),
    }));

    expect(screen.getByText("Vérification de l'import")).toBeInTheDocument();
    expect(screen.getByText(/^La validation a échoué/)).toBeInTheDocument();
    expect(screen.getByText(/^1 ligne met à jour une fiche existante, et cet import remplace toutes ses valeurs\s: le fichier n'a pas de colonne pour Notes, Statut/)).toBeInTheDocument();
    // A message on the line of the person's file, its column by the template's title.
    expect(screen.getByText(/Ligne 6\s:/)).toBeInTheDocument();
    expect(screen.getByText('(ID fournisseur ERP)')).toBeInTheDocument();
    expect(screen.getByText('Erreurs (12)')).toBeInTheDocument();
    expect(screen.getByText('…et 10 erreurs supplémentaires')).toBeInTheDocument();
    expect(screen.getByText('Avertissements (1)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approuver' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rejeter' })).toBeEnabled();
  });

  it('shows a passed check, then what the import did, in French', () => {
    const passed = {
      ok: true, dry_run: true, total: 3, inserted: 2, updated: 1, unchanged: 0, skipped: 0, error_count: 0, warning_count: 0,
      report: { kind: 'rows' as const, errors: [], warnings: [] },
    };
    renderCard(preview({
      tool_name: 'prepare_import_mapping',
      target: { entity_type: 'imports', entity_id: null, ref: null, title: 'Fournisseurs · fournisseurs.xlsx' },
      import_mapping: importMapping({ validation: passed }),
    }));
    expect(screen.getByText(/^Validation réussie\. Prêt à importer 3 lignes\./)).toBeInTheDocument();
    expect(screen.getByText('2 à insérer · 1 à mettre à jour')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approuver' })).toBeEnabled();
    cleanup();

    renderCard(preview({
      tool_name: 'prepare_import_mapping',
      status: 'executed',
      requires_confirmation: false,
      actions: [],
      summary: 'Appliqué : import de « fournisseurs.xlsx » dans la liste Fournisseurs. Créées : 2, mises à jour : 1.',
      target: { entity_type: 'imports', entity_id: null, ref: null, title: 'Fournisseurs · fournisseurs.xlsx' },
      import_mapping: importMapping({ validation: passed, result: { ...passed, dry_run: false } }),
    }));
    expect(screen.queryByText("Vérification de l'import")).not.toBeInTheDocument();
    expect(screen.getByText('Importation terminée avec succès.')).toBeInTheDocument();
    expect(screen.getByText('2 créées · 1 mise à jour')).toBeInTheDocument();
  });

  it('downloads the file prepared for the import with a button after Reject, and says when it fails', async () => {
    const download = vi.mocked(downloadServerExport);
    download.mockClear();
    renderCard(preview({
      tool_name: 'prepare_import_mapping',
      target: { entity_type: 'imports', entity_id: null, ref: null, title: 'Fournisseurs · fournisseurs.xlsx' },
      import_mapping: importMapping({
        validation: {
          ok: true, dry_run: true, total: 3, inserted: 3, updated: 0, unchanged: 0, skipped: 0, error_count: 0, warning_count: 0,
          report: { kind: 'rows', errors: [], warnings: [] },
        },
      }),
    }));
    const button = screen.getByRole('button', { name: 'Télécharger le fichier (.xlsx)' });
    const reject = screen.getByRole('button', { name: 'Rejeter' });
    expect(reject.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(button);
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(download.mock.calls[0][0]).toMatchObject({
      url: '/ai/conversations/conv-1/previews/preview-1/import-file/export',
      format: 'xlsx',
    });
    expect(screen.queryByText("Échec de l'exportation. Veuillez réessayer.")).not.toBeInTheDocument();

    download.mockRejectedValueOnce(new Error('network'));
    fireEvent.click(button);
    expect(await screen.findByText("Échec de l'exportation. Veuillez réessayer.")).toBeInTheDocument();
    cleanup();

    // Once applied, the card keeps the download alone.
    renderCard(preview({
      tool_name: 'prepare_import_mapping',
      status: 'executed',
      requires_confirmation: false,
      actions: [],
      target: { entity_type: 'imports', entity_id: null, ref: null, title: 'Fournisseurs · fournisseurs.xlsx' },
      import_mapping: importMapping({}),
    }));
    expect(screen.getByRole('button', { name: 'Télécharger le fichier (.xlsx)' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Rejeter' })).not.toBeInTheDocument();
  });

  it('shows the check of a budget file as its import dialog does, under the card status', () => {
    renderCard(preview({
      tool_name: 'prepare_import_mapping',
      target: { entity_type: 'imports', entity_id: null, ref: null, title: 'Lignes budgétaires · budget.csv' },
      import_mapping: importMapping({
        import_key: 'budget_lines',
        validation: {
          ok: false, dry_run: true, total: 2, inserted: 0, updated: 0, unchanged: 0, skipped: 0, error_count: 1, warning_count: 0,
          report: {
            kind: 'budget_file',
            file: {
              ok: false,
              notices: {},
              fileErrors: [],
              headerErrors: [],
              errors: [{ line: 7, column: 'account_number', message: 'Unknown account 7000' }],
              errorCount: 1,
              missing: [],
              deleted: [],
              deletedCount: 0,
              changes: { created: 0, updated: 0, unchanged: 0, createdLines: [], updatedLines: [] },
              changedSinceExport: [],
              changedSinceExportCount: 0,
              warnings: { duplicates: [], ignoredColumns: [], supplierNames: [], ignoredCells: [] },
              creates: { dimensionValues: [], suppliers: [] },
              supplierMessage: null,
            } as any,
          },
        },
      }),
    }));
    expect(screen.getByText(/^La validation a échoué/)).toBeInTheDocument();
    // The dialog's own status line (it loads where the card approves) is not shown.
    expect(screen.queryByText(/^Ce fichier ne peut pas encore être chargé/)).not.toBeInTheDocument();
    expect(screen.getByText(/Unknown account 7000/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approuver' })).toBeDisabled();
  });

  const budgetCheck = (duplicates: Array<{ line: number; message: string; code: string; params: Record<string, string | number> }>, duplicatesCount: number) => importMapping({
    import_key: 'budget_lines',
    validation: {
      ok: true, dry_run: true, total: 30, inserted: 30, updated: 0, unchanged: 0, skipped: 0, error_count: 0, warning_count: duplicates.length,
      report: {
        kind: 'budget_file',
        file: {
          ok: true,
          notices: {},
          fileErrors: [],
          headerErrors: [],
          errors: [],
          errorCount: 0,
          missing: [],
          deleted: [],
          deletedCount: 0,
          changes: { created: 30, updated: 0, unchanged: 0, createdLines: [], updatedLines: [] },
          changedSinceExport: [],
          changedSinceExportCount: 0,
          warnings: { duplicates, duplicatesCount, ignoredColumns: [], supplierNames: [], ignoredCells: [] },
          creates: { dimensionValues: [], suppliers: [] },
          supplierMessage: null,
        } as any,
      },
    },
  });
  const looksLikeLine = (line: number, ref: string) => ({ line, message: `row ${line} looks like ${ref}`, code: 'BUDGET_FILE_LOOKS_LIKE_LINE', params: { line, ref } });

  it('counts the rows of a budget file that look like existing lines on its summary line and lists them before Approve', () => {
    readableResources = ['budget'];
    renderCard(preview({
      tool_name: 'prepare_import_mapping',
      summary: 'Importer « budget.xlsx » dans la liste Lignes budgétaires.',
      target: { entity_type: 'imports', entity_id: null, ref: null, title: 'Lignes budgétaires · budget.xlsx' },
      import_mapping: budgetCheck([
        looksLikeLine(12, 'BL-104'),
        { line: 14, message: 'row 14 looks like row 12', code: 'BUDGET_FILE_LOOKS_LIKE_ROW', params: { line: 14, row: 12 } },
      ], 2),
    }));
    // The number, with the warning icon, on the summary line.
    const count = screen.getByRole('img', { name: 'Avertissements (2)' });
    expect(count).toHaveTextContent('2');
    expect(screen.getByText('Importer « budget.xlsx » dans la liste Lignes budgétaires.').parentElement).toContainElement(count);
    // Each one in the sentence of the import dialog, once (the check below does not repeat them), before Approve.
    const line = screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === 'La ligne 12 ressemble à BL-104.');
    expect(screen.getByText('La ligne 14 ressemble à la ligne 12.')).toBeInTheDocument();
    expect(document.body.textContent!.match(/ressemble à/g)).toHaveLength(2);
    expect(line.compareDocumentPosition(screen.getByRole('button', { name: 'Approuver' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The existing line opens from its reference.
    expect(screen.getByRole('link', { name: 'BL-104' })).toHaveAttribute('href', '/ops/budget/BL-104');
    expect(screen.getByRole('button', { name: 'Approuver' })).toBeEnabled();
  });

  it('shows the first ten lookalikes and the others on a click, a reference without a link to a person who may not read budget lines', () => {
    readableResources = [];
    const kept = Array.from({ length: 20 }, (_, index) => looksLikeLine(index + 2, `BL-${index + 101}`));
    renderCard(preview({
      tool_name: 'prepare_import_mapping',
      summary: 'Importer « budget.xlsx » dans la liste Lignes budgétaires.',
      target: { entity_type: 'imports', entity_id: null, ref: null, title: 'Lignes budgétaires · budget.xlsx' },
      import_mapping: budgetCheck(kept, 25),
    }));
    expect(screen.getByRole('img', { name: 'Avertissements (25)' })).toHaveTextContent('25');
    expect(document.body.textContent!.match(/ressemble à/g)).toHaveLength(10);
    expect(screen.getByText('La ligne 11 ressemble à BL-110.')).toBeInTheDocument();
    expect(screen.queryByText('La ligne 12 ressemble à BL-111.')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'BL-101' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'et 15 de plus' }));
    expect(document.body.textContent!.match(/ressemble à/g)).toHaveLength(20);
    expect(screen.getByText('La ligne 21 ressemble à BL-120.')).toBeInTheDocument();
    // The check keeps the first twenty: the others are counted.
    expect(screen.getByText('Et 5 de plus.')).toBeInTheDocument();
    readableResources = ['budget'];
  });

  it('writes each refusal of the budget file as its sentence in the language of the screen, never its code', () => {
    renderCard(preview({
      tool_name: 'prepare_import_mapping',
      target: { entity_type: 'imports', entity_id: null, ref: null, title: 'Lignes budgétaires · budget.xlsx' },
      import_mapping: importMapping({
        import_key: 'budget_lines',
        validation: {
          ok: false, dry_run: true, total: 2, inserted: 0, updated: 0, unchanged: 0, skipped: 0, error_count: 2, warning_count: 0,
          report: {
            kind: 'budget_file',
            file: {
              ok: false,
              notices: {},
              fileErrors: [],
              headerErrors: [],
              errors: [
                { line: 3, column: 'analytics:it_tower', message: 'A value of IT tower must be 255 characters or fewer.', code: 'BUDGET_FILE_DIMENSION_VALUE_TOO_LONG', params: { name: 'Tour IT', max: 255 } },
                { line: 4, column: 'account_number', message: "Account 7000 is not in the company's chart of accounts.", code: 'BUDGET_FILE_ACCOUNT_NOT_IN_CHART', params: { value: '7000' } },
              ],
              errorCount: 2,
              missing: [],
              deleted: [],
              deletedCount: 0,
              changes: { created: 0, updated: 0, unchanged: 0, createdLines: [], updatedLines: [] },
              changedSinceExport: [],
              changedSinceExportCount: 0,
              warnings: { duplicates: [], ignoredColumns: [], supplierNames: [], ignoredCells: [] },
              creates: { dimensionValues: [], suppliers: [] },
              supplierMessage: null,
            } as any,
          },
        },
      }),
    }));
    expect(screen.getByText(/Une valeur de Tour IT ne doit pas dépasser 255 caractères\./)).toBeInTheDocument();
    expect(screen.getByText(/Le compte 7000 n'est pas dans le plan comptable de la société\./)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/BUDGET_FILE_|is not in the company's chart/);
  });
});
