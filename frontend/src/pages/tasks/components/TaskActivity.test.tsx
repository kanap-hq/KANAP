import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TaskActivity from './TaskActivity';

const { t } = vi.hoisted(() => ({ t: (key: string) => key }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t, i18n: { language: 'en' } }),
}));

vi.mock('./TaskComments', () => ({
  default: () => <div data-testid="task-comments" />,
}));

vi.mock('./TaskWorkLog', () => ({
  default: () => <div data-testid="task-work-log" />,
}));

describe('TaskActivity', () => {
  it('shows comments and the work log, with no History sub-tab', () => {
    render(<TaskActivity taskId="task-1" relatedObjectType="project" currentStatus="open" />);
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toEqual(['activity.tabs.comments', 'activity.tabs.workLog']);
    expect(screen.queryByRole('tab', { name: /history/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('task-comments')).toBeInTheDocument();
  });

  it('shows the comments alone for a task with no time logging', () => {
    render(<TaskActivity taskId="task-1" relatedObjectType="spend_item" currentStatus="open" />);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['activity.tabs.comments']);
  });
});
