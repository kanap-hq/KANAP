import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../../config/ThemeContext';
import ProjectActivityTab from './ProjectActivityTab';
import RequestActivityTab from '../request/RequestActivityTab';

const stableT = (key: string) => key;
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
// The real comments list: it reads each entry's text through the Markdown renderer.
vi.mock('../../../../components/MarkdownContent', () => ({
  MarkdownContent: (props: { content?: string | null }) => <div>{props.content}</div>,
}));
vi.mock('../../../../components/MarkdownEditor', () => ({ default: () => <div data-testid="editor" /> }));
vi.mock('../../../../i18n/useLocale', () => ({ useLocale: () => 'en' }));

const entry = (id: string, type: 'comment' | 'change' | 'decision') => ({
  id,
  type,
  content: type === 'change' ? null : `Text ${id}`,
  context: null,
  decision_outcome: type === 'decision' ? 'go' : null,
  changed_fields: type === 'change' ? { name: ['Old name', 'New name'] as [unknown, unknown] } : undefined,
  author_id: 'u-1',
  first_name: 'Ada',
  last_name: 'Spec',
  created_at: '2026-10-29T10:00:00Z',
});

const props = {
  activities: [entry('a-1', 'comment'), entry('a-2', 'change'), entry('a-3', 'decision')],
  allowedTransitions: [],
  currentStatus: 'planned',
  entityId: 'p-1',
  onAddComment: async () => undefined,
  onImageUpload: async () => '',
  onImageUrlImport: async () => '',
  onUpdateComment: async () => undefined,
  readOnly: false,
  statusOptions: [],
};

function renderWithTheme(node: React.ReactNode) {
  return render(<ThemeProvider theme={createAppTheme('light')}>{node}</ThemeProvider>);
}

describe('portfolio activity feeds', () => {
  it('shows the project feed as its comments and decisions, with no tab row and no change entry', () => {
    renderWithTheme(<ProjectActivityTab {...props} />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByText('Text a-1')).toBeInTheDocument();
    expect(screen.getByText('Text a-3')).toBeInTheDocument();
    expect(screen.queryByText(/New/)).toBeNull();
    expect(screen.queryByText('activity.tabs.history')).toBeNull();
  });

  it('shows the request feed the same way: its changes read in the History tab', () => {
    renderWithTheme(<RequestActivityTab {...props} entityId="r-1" />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByText('Text a-1')).toBeInTheDocument();
    expect(screen.getByText('Text a-3')).toBeInTheDocument();
    expect(screen.queryByText(/New/)).toBeNull();
    expect(screen.queryByText('activity.tabs.history')).toBeNull();
  });
});
