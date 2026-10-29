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
// The comments and the feed history have their own tests: here they only mark where they render.
vi.mock('../../components/PortfolioComments', () => ({
  default: () => <div data-testid="portfolio-comments" />,
}));
vi.mock('../../components/PortfolioHistory', () => ({
  default: () => <div data-testid="portfolio-history" />,
}));

const props = {
  activities: [],
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
  it('shows the project feed with its comments only: its changes read in the History tab', () => {
    renderWithTheme(<ProjectActivityTab {...props} />);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['activity.tabs.comments']);
    expect(screen.getByTestId('portfolio-comments')).toBeInTheDocument();
    expect(screen.queryByTestId('portfolio-history')).toBeNull();
  });

  it('keeps the History sub-tab of the request feed', () => {
    renderWithTheme(<RequestActivityTab {...props} />);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['activity.tabs.comments', 'activity.tabs.history']);
  });
});
