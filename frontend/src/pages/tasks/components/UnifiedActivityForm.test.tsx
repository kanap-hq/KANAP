import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import { createAppTheme } from '../../../config/ThemeContext';
import UnifiedActivityForm from './UnifiedActivityForm';

vi.mock('../../../api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('../../../components/MarkdownEditor', () => ({
  default: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  }) => (
    <textarea aria-label={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

const NBSP = '\u00a0';

/** The French status name, quoted with the no-break spaces frenchSpacing inserts. */
function quotedFr(status: string): string {
  return `«${NBSP}${status}${NBSP}»`;
}

const CASES = [
  {
    lng: 'fr',
    option: 'En cours',
    alone: `Passer à ${quotedFr('En cours')}`,
    withComment: `Commentaire et passer à ${quotedFr('En cours')}`,
    withHours: `Passer à ${quotedFr('En cours')} et saisir 2${NBSP}h`,
    withBoth: `Commentaire, passer à ${quotedFr('En cours')} et saisir 2${NBSP}h`,
  },
  {
    lng: 'en',
    option: 'In progress',
    alone: 'Set to “In progress”',
    withComment: 'Comment & set to “In progress”',
    withHours: 'Set to “In progress” & log 2h',
    withBoth: 'Comment, set to “In progress” & log 2h',
  },
  {
    lng: 'de',
    option: 'In Bearbeitung',
    alone: 'Auf «In Bearbeitung» setzen',
    withComment: 'Kommentar & auf «In Bearbeitung» setzen',
    withHours: 'Auf «In Bearbeitung» setzen & 2\u00a0Std. erfassen',
    withBoth: 'Kommentar, auf «In Bearbeitung» setzen & 2\u00a0Std. erfassen',
  },
  {
    lng: 'es',
    option: 'En curso',
    alone: 'Pasar a «En curso»',
    withComment: 'Comentario y pasar a «En curso»',
    withHours: 'Pasar a «En curso» y registrar 2\u00a0h',
    withBoth: 'Comentario, pasar a «En curso» y registrar 2\u00a0h',
  },
] as const;

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <UnifiedActivityForm taskId="task-1" currentStatus="open" onSuccess={() => {}} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

function submitText(): string {
  const button = screen.getByRole('button');
  return button.textContent ?? '';
}

async function chooseStatus(label: string) {
  fireEvent.mouseDown(screen.getByRole('combobox'));
  const listbox = await screen.findByRole('listbox');
  fireEvent.click(within(listbox).getByRole('option', { name: label }));
}

function setHours(hours: number) {
  fireEvent.change(screen.getByRole('slider'), { target: { value: String(hours), valueAsNumber: hours } });
}

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('en');
});

describe('UnifiedActivityForm submit label', () => {
  it.each(CASES)(
    'phrases a status change in $lng, alone and with a comment and hours',
    async ({ lng, option, alone, withComment, withHours, withBoth }) => {
      await i18n.changeLanguage(lng);
      renderForm();

      await chooseStatus(option);
      expect(submitText()).toBe(alone);

      const comment = await screen.findByRole('textbox');
      fireEvent.change(comment, { target: { value: 'A note' } });
      expect(submitText()).toBe(withComment);

      setHours(2);
      expect(submitText()).toBe(withBoth);

      fireEvent.change(comment, { target: { value: '' } });
      expect(submitText()).toBe(withHours);
    },
  );
});
