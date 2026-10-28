import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import KnowledgeSidebar from './KnowledgeSidebar';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));

// The history reads the document from the API; the panel only mounts it and hands it the table and
// the document id, so a stand-in records exactly that.
vi.mock('../../../components/history/RecordHistory', () => ({
  default: ({ table, recordId }: { table: string; recordId: string }) => (
    <div data-testid="record-history" data-table={table} data-record={recordId} />
  ),
}));

const theme = createAppTheme('light');

function relationSelections() {
  return { applications: [], assets: [], projects: [], requests: [], tasks: [], incidents: [] };
}

function props(overrides: Record<string, unknown> = {}) {
  return {
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
    versions: [],
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
    ...overrides,
  };
}

function renderSidebar(overrides: Record<string, unknown> = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <KnowledgeSidebar {...(props(overrides) as any)} />
    </ThemeProvider>,
  );
}

describe('KnowledgeSidebar history tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is the third tab, after comments, and mounts the history only when opened', () => {
    renderSidebar();

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'sidebar.tabs.properties',
      'sidebar.tabs.comments',
      'sidebar.tabs.history',
    ]);
    expect(screen.queryByTestId('record-history')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'sidebar.tabs.history' }));
    const history = screen.getByTestId('record-history');
    expect(history).toHaveAttribute('data-table', 'documents');
    expect(history).toHaveAttribute('data-record', 'doc-1');

    // Leaving the tab unmounts it: a page opened on properties never reads the history.
    fireEvent.click(screen.getByRole('tab', { name: 'sidebar.tabs.comments' }));
    expect(screen.queryByTestId('record-history')).toBeNull();
  });

  it('is absent while a document is created', () => {
    renderSidebar({ isCreate: true });
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'sidebar.tabs.properties',
      'sidebar.tabs.comments',
    ]);
  });
});
