import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import type { Incident } from '../../../api/endpoints/incidents';
import { createAppTheme } from '../../../config/ThemeContext';
import IncidentMetadataBar from './IncidentMetadataBar';

// The incident metadata bar opens its date and time popover on the detected date. A date that cannot
// be read must leave the saved timestamp alone, including when the popover closes.

vi.mock('../../../components/workspace/MetadataUserPicker', () => ({ default: () => null }));

const detected = new Date(2022, 2, 15, 14, 5).toISOString();

const incident = {
  id: 'incident-1',
  item_number: 1,
  title: 'Router down',
  category: null,
  severity: 'major',
  status: 'open',
  started_at: null,
  detected_at: detected,
  resolved_at: null,
  closed_at: null,
  owner_user_id: null,
  owner_name: null,
  reporter_user_id: null,
  reporter_name: null,
  confidential: false,
  asset_count: 0,
  application_count: 0,
  task_count: 0,
  created_at: detected,
  updated_at: detected,
  description: null,
  source_ref: null,
  personal_data_affected: false,
  authority_notification_required: false,
  authority_notified_at: null,
  notified_parties: null,
  created_by: null,
  updated_by: null,
  counts: { entries: 0, assets: 0, applications: 0, technologies: 0, tasks: 0, documents: 0, attachments: 0 },
} as Incident;

function renderBar(onDetectedAtChange: (next: string) => void) {
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <IncidentMetadataBar
        incident={incident}
        onSeverityChange={() => undefined}
        onOwnerChange={() => undefined}
        onDetectedAtChange={onDetectedAtChange}
      />
    </ThemeProvider>,
  );
}

describe('IncidentMetadataBar detected date popover', () => {
  it('replaces the saved detected date typed in the autoFocused popover', async () => {
    const user = userEvent.setup();
    const onDetectedAtChange = vi.fn();
    renderBar(onDetectedAtChange);

    fireEvent.click(screen.getByRole('button', { name: /2022/ }));
    const date = screen.getByPlaceholderText('dd/mm/yyyy') as HTMLInputElement;
    expect(date.selectionStart).toBe(0);
    expect(date.selectionEnd).toBe(date.value.length);
    await user.type(date, '21102026', { skipClick: true });
    expect(date.value).toBe('21/10/2026');
    expect(onDetectedAtChange).toHaveBeenLastCalledWith(new Date(2026, 9, 21, 14, 5).toISOString());
  });

  it('leaves the saved timestamp untouched when an invalid date closes with the popover', async () => {
    const onDetectedAtChange = vi.fn();
    renderBar(onDetectedAtChange);

    fireEvent.click(screen.getByRole('button', { name: /2022/ }));
    const date = screen.getByPlaceholderText('dd/mm/yyyy') as HTMLInputElement;
    fireEvent.change(date, { target: { value: '21/10/26' } });
    fireEvent.blur(date);
    expect(date).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Invalid date')).toBeInTheDocument();
    expect(onDetectedAtChange).not.toHaveBeenCalled();

    fireEvent.click(document.querySelector('.MuiBackdrop-root') as HTMLElement);
    await waitFor(() => expect(screen.queryByPlaceholderText('dd/mm/yyyy')).not.toBeInTheDocument());
    expect(onDetectedAtChange).not.toHaveBeenCalled();
  });
});
