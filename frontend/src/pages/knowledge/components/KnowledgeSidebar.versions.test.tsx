import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import i18n from '../../../i18n';
import deKnowledge from '../../../locales/de/knowledge.json';
import enKnowledge from '../../../locales/en/knowledge.json';
import esKnowledge from '../../../locales/es/knowledge.json';
import frKnowledge from '../../../locales/fr/knowledge.json';
import KnowledgeSidebar from './KnowledgeSidebar';

vi.mock('../../../components/history/RecordHistory', () => ({
  default: () => null,
}));

const theme = createAppTheme('light');

function relationSelections() {
  return { applications: [], assets: [], projects: [], requests: [], tasks: [], incidents: [] };
}

function renderSidebar(versions: Array<{ id: string; version_number: number; change_note: string | null }>) {
  return render(
    <ThemeProvider theme={theme}>
      <KnowledgeSidebar
        {...({
          doc: { id: 'doc-1', item_number: 9, status: 'published', contributors: [], classifications: [] },
          form: {
            status: 'published',
            summary: '',
            folder_id: null,
            library_id: 'library-1',
            document_type_id: null,
            template_document_id: null,
            template_document_title: '',
            revision: 1,
          },
          onChange: vi.fn(),
          isCreate: false,
          editMode: false,
          canManage: true,
          canComment: true,
          contributorOptions: [],
          contributorAssignments: {
            owner_user_id: null,
            author_user_ids: [],
            reviewer_user_ids: [],
            approver_user_ids: [],
          },
          onContributorAssignmentsChange: vi.fn(),
          contributorsError: null,
          documentTypeOptions: [],
          folderOptions: [],
          classificationCategories: [],
          classificationStreams: [],
          classificationRows: [],
          onClassificationRowsChange: vi.fn(),
          classificationError: null,
          relationSelections: relationSelections(),
          relationKeys: [],
          onRelationSelectionsChange: vi.fn(),
          relationSearch: { applications: '', assets: '', projects: '', requests: '', tasks: '', incidents: '' },
          onRelationSearchChange: vi.fn(),
          relationOptions: relationSelections(),
          relationsError: null,
          versions,
          onRevertVersion: vi.fn(),
          revertingVersion: false,
          lockToken: null,
          workflow: null,
          latestApprovedWorkflow: null,
          currentUserId: 'user-1',
          canApproveWorkflow: false,
          onApproveWorkflow: vi.fn(async () => undefined),
          approvingWorkflow: false,
          onRequestWorkflowChanges: vi.fn(async () => undefined),
          requestingWorkflowChanges: false,
          activities: [],
          commentText: '',
          onCommentTextChange: vi.fn(),
          onPostComment: vi.fn(),
          postingComment: false,
        } as any)}
      />
    </ThemeProvider>,
  );
}

const STORED_NOTES = [
  { id: 'v3', version_number: 3, change_note: 'Revert to version 2' },
  { id: 'v2', version_number: 2, change_note: 'Correction du sommaire' },
  { id: 'v1', version_number: 1, change_note: 'Initial version' },
  { id: 'near', version_number: 4, change_note: 'Revert to version 2, schéma ajouté' },
  { id: 'req', version_number: 5, change_note: 'Imported from legacy request field' },
  { id: 'if', version_number: 6, change_note: 'Imported from legacy interface fields' },
  { id: 'app', version_number: 7, change_note: 'Imported from legacy application description' },
  { id: 'inc', version_number: 8, change_note: 'Imported from legacy incident fields' },
  { id: 'prj', version_number: 9, change_note: 'Imported from legacy project field' },
];

/** The version captions, without the leading dash the sidebar puts before a note. */
function versionNotes(): string[] {
  return screen.getAllByText((_, element) => {
    if (!element || element.children.length > 0) return false;
    return (element.textContent ?? '').trim().startsWith('-');
  }).map((element) => (element.textContent ?? '').trim().replace(/^- /, ''));
}

// The server writes these notes in English. The sidebar shows them in the reader's language,
// existing versions included. A note someone typed stays as written, including one that only
// starts like the revert sentence.
describe('KnowledgeSidebar version notes', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows the notes the app writes in French and a typed note as written', async () => {
    await i18n.changeLanguage('fr');
    renderSidebar(STORED_NOTES);

    expect(versionNotes()).toEqual([
      'Restauration de la version 2',
      'Correction du sommaire',
      'Version initiale',
      'Revert to version 2, schéma ajouté',
      'Importé depuis l\'ancien champ de la demande',
      'Importé depuis les anciens champs de l\'interface',
      'Importé depuis l\'ancienne description de l\'application',
      'Importé depuis les anciens champs de l\'incident',
      'Importé depuis l\'ancien champ du projet',
    ]);
  });

  it('keeps the same note keys, and the version number, in every language', () => {
    const notes = {
      en: enKnowledge.sidebar.versions.notes,
      fr: frKnowledge.sidebar.versions.notes,
      de: deKnowledge.sidebar.versions.notes,
      es: esKnowledge.sidebar.versions.notes,
    };
    const keys = Object.keys(notes.en).sort();
    expect(keys).toEqual([
      'importedApplication',
      'importedIncident',
      'importedInterfaces',
      'importedProject',
      'importedRequest',
      'initial',
      'revert',
    ]);
    for (const locale of Object.values(notes)) {
      expect(Object.keys(locale).sort()).toEqual(keys);
      expect(locale.revert).toContain('{{version}}');
    }
    expect(notes.en.initial).toBe('Initial version');
    expect(notes.en.revert).toBe('Revert to version {{version}}');
    expect(notes.fr.initial).not.toBe(notes.en.initial);
    expect(notes.de.initial).not.toBe(notes.en.initial);
    expect(notes.es.initial).not.toBe(notes.en.initial);
  });
});
