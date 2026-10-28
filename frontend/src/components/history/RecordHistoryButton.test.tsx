import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

const mounts = vi.hoisted(() => ({ count: 0 }));
const t = vi.hoisted(() => (key: string) => key);

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('./RecordHistory', () => ({
  default: ({ table, recordId }: { table: string; recordId: string }) => {
    mounts.count += 1;
    return <div>{`${table}:${recordId}:${mounts.count}`}</div>;
  },
}));

import RecordHistoryButton from './RecordHistoryButton';

function renderButton(table = 'business_processes', recordId = 'bp-1') {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <RecordHistoryButton table={table} recordId={recordId} />
    </ThemeProvider>,
  );
}

describe('RecordHistoryButton', () => {
  beforeEach(() => {
    mounts.count = 0;
  });

  it('mounts the history only when the panel opens', () => {
    renderButton();
    expect(screen.queryByText('business_processes:bp-1:1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'admin:auditLogs.history.title' }));
    expect(screen.getByText('business_processes:bp-1:1')).toBeInTheDocument();
    expect(screen.getByText('admin:auditLogs.history.title')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common:buttons.close' })).toBeInTheDocument();
  });

  it('closes on Escape and gives the focus back to its button', async () => {
    renderButton();
    const button = screen.getByRole('button', { name: 'admin:auditLogs.history.title' });
    fireEvent.click(button);
    expect(screen.getByText('business_processes:bp-1:1')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByText('business_processes:bp-1:1')).toBeNull();
    await waitFor(() => expect(button).toHaveFocus());
  });

  it('closes on its close button and mounts a fresh history on each opening', () => {
    renderButton('working_day_profiles', 'wd-1');
    const button = screen.getByRole('button', { name: 'admin:auditLogs.history.title' });
    fireEvent.click(button);
    expect(screen.getByText('working_day_profiles:wd-1:1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.close' }));
    expect(screen.queryByText('working_day_profiles:wd-1:1')).toBeNull();
    fireEvent.click(button);
    expect(screen.getByText('working_day_profiles:wd-1:2')).toBeInTheDocument();
  });
});
