import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import PortfolioComments from './PortfolioComments';

vi.mock('../../../components/MarkdownEditor', () => ({
  default: () => <textarea aria-label="comment" />,
}));

const STATUS_NAME = 'Change status to…';

function renderComments(entityType: 'request' | 'project') {
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <PortfolioComments
        entityType={entityType}
        entityId="id-1"
        activities={[]}
        currentStatus="submitted"
        allowedTransitions={['approved']}
        statusOptions={[{ value: 'approved', label: 'Approved' }]}
        onAddComment={async () => {}}
      />
    </ThemeProvider>,
  );
}

describe('comment status menu focus', () => {
  it.each(['request', 'project'] as const)(
    'keeps the focus on the status menu of a %s comment after a keyboard choice',
    async (entityType) => {
      renderComments(entityType);
      fireEvent.click(screen.getByRole('checkbox', { name: 'Formal decision' }));
      const status = screen.getAllByRole('combobox')[1];
      expect(screen.getByText(STATUS_NAME)).toBeInTheDocument();
      status.focus();
      fireEvent.keyDown(status, { key: 'Enter' });
      const listbox = await screen.findByRole('listbox');
      fireEvent.keyDown(listbox, { key: 'ArrowDown' });
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' });
      await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
      expect(document.activeElement).toBe(screen.getAllByRole('combobox')[1]);
    },
  );
});
