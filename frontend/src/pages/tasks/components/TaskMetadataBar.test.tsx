import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import '../../../i18n';
import { createAppTheme } from '../../../config/ThemeContext';
import TaskMetadataBar from './TaskMetadataBar';

vi.mock('../../../components/workspace/MetadataUserPicker', () => ({ default: () => null }));

function renderBar(onPatch: (patch: Record<string, unknown>) => void) {
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <TaskMetadataBar
        status="open"
        priorityLevel="normal"
        priorityScore={50}
        assigneeUserId={null}
        assigneeName={null}
        dueDate="2026-03-21"
        onPatch={onPatch}
      />
    </ThemeProvider>,
  );
}

describe('TaskMetadataBar due date', () => {
  it('saves a typed due date once on Enter and closes the popover', async () => {
    const user = userEvent.setup();
    const onPatch = vi.fn();
    renderBar(onPatch);

    fireEvent.click(screen.getByText(/21 Mar/));
    const date = screen.getByPlaceholderText('dd/mm/yyyy') as HTMLInputElement;
    await user.click(date);
    await user.type(date, '15102026', { skipClick: true });
    expect(onPatch).not.toHaveBeenCalled();

    // The popover closes on the save: the blur of that close must not save the date again.
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByPlaceholderText('dd/mm/yyyy')).not.toBeInTheDocument());
    expect(onPatch.mock.calls).toEqual([[{ due_date: '2026-10-15' }]]);
  });
});
