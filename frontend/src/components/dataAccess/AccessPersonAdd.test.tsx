import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../design';
import { usePersonAccessActions } from './usePersonAccessActions';
import type { UserOption } from '../fields/userLookup';

const t = vi.hoisted(() => (key: string, options?: Record<string, unknown>) => (
  options ? `${key}|${JSON.stringify(options)}` : key
));
const get = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../api', () => ({ default: { get, put, post: vi.fn(), delete: vi.fn() } }));
vi.mock('../fields/UserSelect', () => ({
  default: (props: { onChange: (id: string | null, user: UserOption | null) => void }) => (
    <div>
      <button
        type="button"
        onClick={() => props.onChange('u-1', {
          id: 'u-1',
          first_name: 'Marta',
          last_name: 'Ruiz',
          email: 'marta.admin@example.test',
        })}
      >
        pick Marta admin
      </button>
      <button
        type="button"
        onClick={() => props.onChange('u-2', {
          id: 'u-2',
          first_name: 'Marta',
          last_name: 'Ruiz',
          email: 'marta.user@example.test',
        })}
      >
        pick Marta user
      </button>
      <button
        type="button"
        onClick={() => props.onChange('u-3', {
          id: 'u-3',
          first_name: 'Paul',
          last_name: 'Martin',
          email: null,
        })}
      >
        pick Paul
      </button>
    </div>
  ),
}));

import AccessPersonAdd from './AccessPersonAdd';

/** The add control as a company Access tab wires it: the confirmation names the picked person. */
function Harness() {
  const actions = usePersonAccessActions(() => undefined);
  return (
    <AccessPersonAdd
      onAdd={(personId, access, personName) => actions.setNode(
        personId,
        { type: 'company', id: 'co-1', name: null, access: 'read' },
        access,
        { personName, nodeName: 'Alpha France' },
      )}
    />
  );
}

function renderAdd() {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <KanapDialogProvider>
        <Harness />
      </KanapDialogProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  get.mockImplementation(async (url: string) => {
    if (url.endsWith('/data-access')) return { data: { mode: 'all', nodes: [], is_administrator: false } };
    return { data: {} };
  });
  put.mockResolvedValue({ data: {} });
});

describe('AccessPersonAdd', () => {
  it('names a shared name by its email in the full-access confirmation', async () => {
    renderAdd();
    fireEvent.click(screen.getByRole('button', { name: 'pick Marta admin' }));
    fireEvent.click(screen.getByRole('button', { name: 'admin:dataAccess.accessTab.addButton' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(
      'admin:dataAccess.accessTab.confirmLimited|{"name":"marta.admin@example.test","node":"Alpha France"}',
    )).toBeInTheDocument();
    expect(within(dialog).queryByText(/Marta Ruiz/)).toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: 'buttons.cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'pick Marta user' }));
    fireEvent.click(screen.getByRole('button', { name: 'admin:dataAccess.accessTab.addButton' }));
    const second = await screen.findByRole('dialog');
    expect(within(second).getByText(
      'admin:dataAccess.accessTab.confirmLimited|{"name":"marta.user@example.test","node":"Alpha France"}',
    )).toBeInTheDocument();
  });

  it('keeps the name when the lookup sent no email', async () => {
    renderAdd();
    fireEvent.click(screen.getByRole('button', { name: 'pick Paul' }));
    fireEvent.click(screen.getByRole('button', { name: 'admin:dataAccess.accessTab.addButton' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(
      'admin:dataAccess.accessTab.confirmLimited|{"name":"Paul Martin","node":"Alpha France"}',
    )).toBeInTheDocument();
  });
});
