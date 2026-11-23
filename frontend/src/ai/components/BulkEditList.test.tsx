import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import i18n from '../../i18n';
import type { AiBulkEditRow, AiMutationPreview } from '../aiTypes';
import PreviewCard from './PreviewCard';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: (resource: string) => resource === 'applications' }),
}));

vi.mock('../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ labelFor: (_field: string, code?: string | null) => String(code ?? '') }),
}));

vi.mock('../../api', () => ({
  default: {
    get: vi.fn(async (url: string) => {
      throw new Error(`Unexpected request ${url}`);
    }),
    post: (...args: unknown[]) => post(...args),
  },
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const url = (previewId: string) => `/ai/conversations/conv-1/previews/${previewId}/bulk-exclusions`;

function row(n: number, over: Partial<AiBulkEditRow> = {}): AiBulkEditRow {
  return { id: id(n), ref: `APP-${n}`, title: `App ${n}`, before: 'Faible', before_state: 'value', kept: true, ...over };
}

function bulkCard(rows: AiBulkEditRow[], over: Partial<AiMutationPreview> = {}): AiMutationPreview {
  const kept = rows.filter((entry) => entry.kept).length;
  return {
    preview_id: 'preview-1',
    tool_name: 'bulk_update_applications',
    status: 'pending',
    target: { entity_type: 'applications', entity_id: null, ref: null, title: `${rows.length} applications` },
    changes: {
      application_bulk_edit: {
        label: 'Change in bulk',
        from: null,
        to: `Criticité business → Critique\n\n${kept} applications à modifier`,
        format: 'markdown',
      },
    },
    requires_confirmation: true,
    actions: ['approve', 'reject'],
    summary: 'Modification en masse',
    error_message: null,
    conversation_id: 'conv-1',
    created_at: '2026-11-23T10:00:00.000Z',
    expires_at: null,
    approved_at: null,
    rejected_at: null,
    executed_at: null,
    bulk_edit: { field: 'Criticité business', after: 'Critique', after_empty: false, rows, kept, excluded: rows.length - kept },
    ...over,
  };
}

/** The card the server answers: the same records, those of `excluded` left out. */
function answer(card: AiMutationPreview, excluded: string[], previewId: string): { data: AiMutationPreview } {
  const rows = card.bulk_edit!.rows.map((entry) => ({ ...entry, kept: !excluded.includes(entry.id) }));
  return { data: { ...bulkCard(rows), preview_id: previewId, replaces_preview_id: 'preview-1' } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, ko) => {
    resolve = ok;
    reject = ko;
  });
  return { promise, resolve, reject };
}

const httpError = (status: number, data: Record<string, unknown>) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

/** The card in a conversation that puts the card answered in its place, as `useChat` does. */
function Host({ first, readOnly = false }: { first: AiMutationPreview; readOnly?: boolean }) {
  const [card, setCard] = React.useState(first);
  return (
    <PreviewCard
      preview={card}
      onApprove={() => undefined}
      onReject={() => undefined}
      onReplace={readOnly ? undefined : (_previous, next) => setCard(next)}
    />
  );
}

function renderHost(first: AiMutationPreview, readOnly = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <Host first={first} readOnly={readOnly} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const box = (name: string) => screen.getByRole('checkbox', { name });

describe('the records of a change in bulk on its card', () => {
  beforeEach(async () => {
    post.mockReset();
    await i18n.changeLanguage('fr');
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it('lists each record with a named box, its reference linked, its value before and after; empty and hidden in words', () => {
    renderHost(bulkCard([
      row(1),
      row(2, { before: 'Vide', before_state: 'empty' }),
      row(3, { before: 'Masqué', before_state: 'hidden', kept: false }),
    ]));
    // The server's counts stay above the list.
    expect(screen.getByText(/Criticité business → Critique/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('2 gardées sur 3');
    expect(box('Garder APP-1 App 1')).toBeChecked();
    expect(box('Garder APP-2 App 2')).toBeChecked();
    expect(box('Garder APP-3 App 3')).not.toBeChecked();
    expect(screen.getByRole('link', { name: 'APP-1' })).toHaveAttribute('href', '/it/applications/APP-1');
    expect(screen.getByText('Faible')).toHaveStyle({ textDecoration: 'line-through' });
    expect(screen.getByText('Vide')).toBeInTheDocument();
    expect(screen.getByText('Masqué')).not.toHaveStyle({ textDecoration: 'line-through' });
    expect(screen.getAllByText('Critique')).toHaveLength(3);
    // References only: no record id on screen.
    expect(document.body.textContent).not.toContain(id(1));
  });

  it('names its boxes and counts in English', async () => {
    await i18n.changeLanguage('en');
    renderHost(bulkCard([row(1), row(2, { kept: false })]));
    expect(screen.getByRole('status')).toHaveTextContent('1 kept of 2');
    expect(box('Keep APP-1 App 1')).toBeChecked();
  });

  it('shows the first ten records and the others on a click, the focus on the first one unfolded', () => {
    renderHost(bulkCard(Array.from({ length: 13 }, (_, index) => row(index + 1))));
    expect(screen.getAllByRole('checkbox')).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: 'et 3 de plus' }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(13);
    expect(document.activeElement).toBe(box('Garder APP-11 App 11'));
    expect(screen.getByRole('status')).toHaveTextContent('13 gardées sur 13');
  });

  it('leaves a record out with the whole list, waits for the count, then shows the card answered, the focus kept', async () => {
    const card = bulkCard([row(1), row(2), row(3, { kept: false })]);
    const call = deferred<{ data: AiMutationPreview }>();
    post.mockReturnValueOnce(call.promise);
    renderHost(card);
    const first = box('Garder APP-1 App 1');
    first.focus();
    fireEvent.click(first);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(url('preview-1'), { excluded: [id(3), id(1)] });
    // While the server counts: the box shows the gesture, Approve and Reject wait, a discreet mark shows.
    expect(first).not.toBeChecked();
    expect(screen.getByRole('list')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('progressbar', { name: 'Comptage en cours' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approuver' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rejeter' })).toBeDisabled();

    await act(async () => call.resolve(answer(card, [id(3), id(1)], 'preview-2')));
    expect(screen.getByRole('status')).toHaveTextContent('1 gardée sur 3');
    expect(box('Garder APP-1 App 1')).not.toBeChecked();
    expect(box('Garder APP-2 App 2')).toBeChecked();
    expect(screen.getByRole('list')).toHaveAttribute('aria-busy', 'false');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approuver' })).toBeEnabled();
    expect(document.activeElement).toBe(box('Garder APP-1 App 1'));

    // Ticked again: the next call is on the card answered, with the list left.
    post.mockResolvedValueOnce(answer(card, [id(3)], 'preview-3'));
    fireEvent.click(box('Garder APP-1 App 1'));
    expect(post).toHaveBeenLastCalledWith(url('preview-2'), { excluded: [id(3)] });
    await act(async () => undefined);
    expect(box('Garder APP-1 App 1')).toBeChecked();
  });

  it('sends quick clicks one call at a time, the last state winning', async () => {
    const card = bulkCard([row(1), row(2), row(3)]);
    const first = deferred<{ data: AiMutationPreview }>();
    const second = deferred<{ data: AiMutationPreview }>();
    post.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderHost(card);
    fireEvent.click(box('Garder APP-1 App 1'));
    // During the count: the gesture shows at once, and waits for the count to end.
    fireEvent.click(box('Garder APP-2 App 2'));
    fireEvent.click(box('Garder APP-3 App 3'));
    fireEvent.click(box('Garder APP-3 App 3'));
    expect(box('Garder APP-2 App 2')).not.toBeChecked();
    expect(box('Garder APP-3 App 3')).toBeChecked();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(url('preview-1'), { excluded: [id(1)] });
    await act(async () => first.resolve(answer(card, [id(1)], 'preview-2')));
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenLastCalledWith(url('preview-2'), { excluded: [id(1), id(2)] });
    expect(screen.getByRole('progressbar', { name: 'Comptage en cours' })).toBeInTheDocument();
    await act(async () => second.resolve(answer(card, [id(1), id(2)], 'preview-3')));
    expect(box('Garder APP-1 App 1')).not.toBeChecked();
    expect(box('Garder APP-2 App 2')).not.toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('1 gardée sur 3');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('cannot be approved with every record left out, and says why in the server\'s words', () => {
    const why = 'Toutes les fiches de cette carte sont écartées : il n\'y a rien à approuver.';
    renderHost(bulkCard([row(1, { kept: false }), row(2, { kept: false })], { error_message: why }));
    expect(screen.getByRole('button', { name: 'Approuver' })).toBeDisabled();
    expect(screen.getByText(why)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('0 gardée sur 2');
    // A record ticked again is still offered.
    expect(box('Garder APP-1 App 1')).not.toBeChecked();
    expect(box('Garder APP-1 App 1')).toBeEnabled();
  });

  it('turns stale on a card that can no longer be changed, as an import card', async () => {
    post.mockRejectedValueOnce(httpError(409, { message: 'This card can no longer be changed: ask for a new one.' }));
    renderHost(bulkCard([row(1), row(2)]));
    fireEvent.click(box('Garder APP-1 App 1'));
    await act(async () => undefined);
    expect(screen.getByText(i18n.t('ai:previewCard.importChoices.stale'))).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('turns stale with the server\'s words when the selection grew past what a card lists', async () => {
    const grew = 'La sélection a dépassé 200 fiches depuis le comptage : demandez une nouvelle carte.';
    post.mockRejectedValueOnce(httpError(409, { code: 'bulk_list_grew', message: grew }));
    renderHost(bulkCard([row(1), row(2)]));
    fireEvent.click(box('Garder APP-1 App 1'));
    await act(async () => undefined);
    expect(screen.getByText(grew)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('puts the box back and says to try again when another budget operation runs; the card stays to approve', async () => {
    post.mockRejectedValueOnce(httpError(409, { code: 'operation_running', message: 'Another budget operation is running.' }));
    renderHost(bulkCard([row(1), row(2)]));
    fireEvent.click(box('Garder APP-1 App 1'));
    await act(async () => undefined);
    expect(box('Garder APP-1 App 1')).toBeChecked();
    expect(screen.getByText('Une autre opération est en cours. Réessayez dans un instant.')).toBeInTheDocument();
    expect(screen.getByText('En attente')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approuver' })).toBeEnabled();
    expect(screen.queryByText(i18n.t('ai:previewCard.notApplied'))).not.toBeInTheDocument();
  });

  it('puts the box back with the usual message when the request fails', async () => {
    post.mockRejectedValueOnce(new Error('Network Error'));
    renderHost(bulkCard([row(1), row(2)]));
    fireEvent.click(box('Garder APP-1 App 1'));
    await act(async () => undefined);
    expect(box('Garder APP-1 App 1')).toBeChecked();
    expect(screen.getByText(i18n.t('ai:previewCard.notApplied'))).toBeInTheDocument();
  });

  it('keeps the list read only once approved: the records changed marked, those left out shown as such', () => {
    renderHost(bulkCard([
      row(1, { changed: true }),
      row(2, { kept: false, changed: false }),
      row(3, { changed: false }),
    ], { status: 'executed', executed_at: '2026-11-23T10:05:00.000Z' }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approuver' })).not.toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]).getByText('· Modifiée')).toBeInTheDocument();
    expect(within(items[1]).getByText('· Écartée')).toBeInTheDocument();
    expect(within(items[2]).getByText('· Non modifiée')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('2 gardées sur 3');
  });

  it('keeps the list read only on a rejected card, and without a way to replace it', () => {
    renderHost(bulkCard([row(1), row(2, { kept: false })], { status: 'rejected' }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByText('· Écartée')).toBeInTheDocument();
    cleanup();
    renderHost(bulkCard([row(1), row(2)]), true);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
