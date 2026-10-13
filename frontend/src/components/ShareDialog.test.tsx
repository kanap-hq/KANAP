import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'me', first_name: 'Ada', last_name: 'Lovelace' } }) }));

import api from '../api';
import ShareDialog from './ShareDialog';

const apiGet = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;

const PEOPLE = [
  { id: 'u-1', first_name: 'Hélène', last_name: 'Dupré', email: null, status: 'enabled' },
  { id: 'u-2', first_name: 'Henri', last_name: 'Martin', email: null, status: 'enabled' },
  { id: 'u-3', first_name: 'Marc', last_name: 'Zola', email: null, status: 'enabled' },
];
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Every search waits until the test answers it, as on a slow server. */
let answers: Array<() => void>;
function serveSlowly(people = PEOPLE, hasMore = false) {
  apiGet.mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
    if (url !== '/users/lookup') throw new Error(`unexpected ${url}`);
    await new Promise<void>((resolve) => { answers.push(resolve); });
    const q = fold(String(config?.params?.q ?? ''));
    return { data: { items: people.filter((p) => fold(`${p.first_name} ${p.last_name}`).includes(q)), has_more: hasMore } };
  });
}
const answerAll = async () => {
  await act(async () => {
    answers.splice(0).forEach((answer) => answer());
    await Promise.resolve();
  });
};

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <ShareDialog open onClose={() => undefined} itemType="opex" itemId="item-1" itemName="Line" />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  const input = screen.getByPlaceholderText('share.searchUsersOrEmail') as HTMLInputElement;
  act(() => { input.focus(); });
  fireEvent.mouseDown(input);
  return input;
}

describe('ShareDialog recipients', () => {
  beforeEach(() => {
    answers = [];
    apiGet.mockReset();
  });

  it('the recipient field stays editable while the people search runs (a disabled field loses the focus and the text)', async () => {
    serveSlowly();
    const input = renderDialog();
    // The list opened: its first page is requested, and not answered yet.
    await waitFor(() => expect(answers.length).toBeGreaterThan(0));
    expect(input.disabled).toBe(false);

    // Keystroke by keystroke: during the pause in typing and while each request runs.
    for (const text of ['h', 'he', 'hen']) {
      fireEvent.change(input, { target: { value: text } });
      expect(input.disabled).toBe(false);
      expect(input).toHaveValue(text);
    }
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/users/lookup', expect.objectContaining({ params: { q: 'hen', limit: 30 } })));
    expect(input.disabled).toBe(false);
    expect(input).toHaveValue('hen');
    expect(document.activeElement).toBe(input);

    await answerAll();
    await answerAll();
    expect(await screen.findByRole('option', { name: 'Henri Martin' })).toBeInTheDocument();
    expect(input.disabled).toBe(false);
    expect(input).toHaveValue('hen');
  });

  it('while the next search runs, lists only the people that still match the text typed', async () => {
    serveSlowly();
    const input = renderDialog();
    fireEvent.change(input, { target: { value: 'he' } });
    await waitFor(() => expect(answers.length).toBeGreaterThan(0));
    await answerAll();
    await waitFor(() => expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Hélène Dupré', 'Henri Martin']));

    fireEvent.change(input, { target: { value: 'hel' } });
    // Henri no longer matches: never picked by Enter while the answer is on its way.
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Hélène Dupré']);
    await answerAll();
  });

  it('ends a page that does not hold every match with a hint to type more', async () => {
    serveSlowly(PEOPLE, true);
    renderDialog();
    await waitFor(() => expect(answers.length).toBeGreaterThan(0));
    await answerAll();
    expect(await screen.findByText('selects.moreResults')).toBeInTheDocument();
  });
});


describe('ShareDialog budget links', () => {
  it.each(['opex', 'capex'] as const)('shares %s by its native BL number', (itemType) => {
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><ThemeProvider theme={createAppTheme('light')}>
      <ShareDialog open onClose={() => undefined} itemType={itemType} itemId="uuid" itemName="Line" itemNumber={127} />
    </ThemeProvider></QueryClientProvider>);
    expect(screen.getByText(`${window.location.origin}/ops/budget/BL-127`)).toBeInTheDocument();
    expect(screen.getByText('BL-127')).toBeInTheDocument();
  });
});

describe('ShareDialog contracts', () => {
  it('links the contract overview and sends through the contract route', async () => {
    const apiPost = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;
    apiPost.mockResolvedValue({ data: { ok: true } });
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><ThemeProvider theme={createAppTheme('light')}>
      <ShareDialog open onClose={() => undefined} itemType="contract" itemId="c-1" itemName="SAP Maintenance" />
    </ThemeProvider></QueryClientProvider>);
    expect(screen.getByText(`${window.location.origin}/ops/contracts/c-1/overview`)).toBeInTheDocument();
    const input = screen.getByPlaceholderText('share.searchUsersOrEmail') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'buyer@example.com' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('button', { name: 'share.sendEmail' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/contracts/c-1/share', expect.objectContaining({ recipient_emails: ['buyer@example.com'] })));
  });
});

describe('ShareDialog limits', () => {
  it('sends to 20 recipients at most and shows the error the server returns', async () => {
    const apiPost = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;
    apiPost.mockReset();
    apiPost.mockRejectedValue({ response: { status: 429, data: { message: 'ThrottlerException: Too Many Requests' } } });
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><ThemeProvider theme={createAppTheme('light')}>
      <ShareDialog open onClose={() => undefined} itemType="contract" itemId="c-1" itemName="SAP Maintenance" />
    </ThemeProvider></QueryClientProvider>);
    const input = screen.getByPlaceholderText('share.searchUsersOrEmail') as HTMLInputElement;
    const add = (email: string) => {
      fireEvent.change(input, { target: { value: email } });
      fireEvent.keyDown(input, { key: 'Enter' });
    };
    for (let i = 0; i < 21; i += 1) add(`person${i}@example.com`);
    const send = screen.getByRole('button', { name: 'share.sendEmail' });
    expect(screen.getByText('errors:SHARE_TOO_MANY_RECIPIENTS')).toBeInTheDocument();
    expect(send).toBeDisabled();

    // Back to 20: the hint goes and the link can be sent.
    fireEvent.click(screen.getAllByTestId('CancelIcon')[0]);
    expect(screen.queryByText('errors:SHARE_TOO_MANY_RECIPIENTS')).not.toBeInTheDocument();
    expect(send).toBeEnabled();
    fireEvent.click(send);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/contracts/c-1/share', expect.objectContaining({ recipient_emails: expect.any(Array) })));
    expect(apiPost.mock.calls[0][1].recipient_emails).toHaveLength(20);
    // A rate limit reads as a sentence, not as the server's exception name.
    expect(await screen.findByText('errors:rate_limited')).toBeInTheDocument();
  });

  it('caps the personal message at the length the server accepts', () => {
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><ThemeProvider theme={createAppTheme('light')}>
      <ShareDialog open onClose={() => undefined} itemType="contract" itemId="c-1" itemName="SAP Maintenance" />
    </ThemeProvider></QueryClientProvider>);
    expect(screen.getByPlaceholderText('share.addPersonalMessage')).toHaveAttribute('maxLength', '2000');
  });
});
