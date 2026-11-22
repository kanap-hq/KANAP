import React from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KanapDialogProvider } from '../../design';
import { creationKey, getCreation, resetCreationStore, setCreation } from './creationStore';
import useDraftCreation, { type DraftCreated } from './useDraftCreation';
import CreationActions from './CreationActions';

const stableT = vi.hoisted(() => (key: string) => key);

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

const RECORD_ID = '5f1d7a2e-0000-4000-8000-000000000007';
const RECORD_PATH = `/things/${RECORD_ID}/overview`;

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <KanapDialogProvider>
        <MemoryRouter initialEntries={['/start', RECORD_PATH]} initialIndex={1}>{children}</MemoryRouter>
      </KanapDialogProvider>
    </QueryClientProvider>
  );
}

describe('useDraftCreation Done', () => {
  beforeEach(() => {
    resetCreationStore();
  });

  it('marks a required field the created record shows emptied and keeps the person on it, then closes it once filled', () => {
    setCreation(creationKey('things', RECORD_ID), { token: 'token-1', returnTo: '/start' });
    const values: Record<string, string> = { owner: '' };
    const post = vi.fn();
    const { result } = renderHook(() => ({
      creation: useDraftCreation({
        isCreate: false,
        family: 'things',
        apiBase: '/things',
        recordId: RECORD_ID,
        listPath: '/things',
        recordLabel: 'The thing',
        ready: () => true,
        post,
        missing: () => Object.keys(values).filter((key) => !values[key]),
        valueOf: (key) => values[key],
      }),
      path: useLocation().pathname,
    }), { wrapper });
    expect(result.current.creation.beingCreated).toBe(true);

    act(() => result.current.creation.create());
    expect([...result.current.creation.marked]).toEqual(['owner']);
    expect(result.current.path).toBe(RECORD_PATH);
    expect(getCreation(creationKey('things', RECORD_ID))).toBeTruthy();

    values.owner = 'Ana';
    act(() => result.current.creation.create());
    expect(result.current.path).toBe('/start');
    expect(getCreation(creationKey('things', RECORD_ID))).toBeUndefined();
    expect(post).not.toHaveBeenCalled();
  });
});

/** A field that commits as the focus leaves it, and on Enter by blurring itself, like the record pages. */
function Field({ label, onCommit }: { label: string; onCommit: (value: string) => void }) {
  const [value, setValue] = React.useState('');
  return (
    <input
      aria-label={label}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
    />
  );
}

/** A new record's draft: a name and an email to give (the email last), a phone besides. */
function DraftPage({ post }: { post: (draft: { name: string; email: string }) => Promise<DraftCreated | null> }) {
  const [draft, setDraft] = React.useState({ name: '', email: '', phone: '' });
  const draftRef = React.useRef(draft);
  draftRef.current = draft;
  const navigate = useNavigate();
  const creation = useDraftCreation({
    isCreate: true,
    family: 'things',
    apiBase: '/things',
    recordId: null,
    listPath: '/things',
    recordLabel: 'The thing',
    ready: () => !!draftRef.current.name.trim() && !!draftRef.current.email.trim(),
    post: () => post(draftRef.current),
    missing: () => (['name', 'email'] as const).filter((key) => !draftRef.current[key].trim()),
  });
  const { attempt } = creation;
  React.useEffect(() => { attempt(); }, [attempt, draft]);
  const commit = (key: 'name' | 'email' | 'phone') => (value: string) => setDraft((prev) => ({ ...prev, [key]: value }));
  return (
    <div data-workspace-shell="">
      <button type="button" onClick={() => navigate('/elsewhere')}>back</button>
      <CreationActions onCreate={() => creation.create()} onCancel={() => navigate('/elsewhere')} writing={creation.writing} />
      <Field label="name" onCommit={commit('name')} />
      <Field label="email" onCommit={commit('email')} />
      <Field label="phone" onCommit={commit('phone')} />
    </div>
  );
}

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

const THING = { id: RECORD_ID, token: 'token-1', path: RECORD_PATH, reference: null };

function renderDraft(post: (draft: { name: string; email: string }) => Promise<DraftCreated | null>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <KanapDialogProvider>
        <MemoryRouter initialEntries={['/things/new']}>
          <Where />
          <nav><Link to="/elsewhere">menu</Link></nav>
          <Routes>
            <Route path="/things/new" element={<DraftPage post={post} />} />
            <Route path="/things/:id/overview" element={<div data-testid="record" />} />
            <Route path="/elsewhere" element={<div data-testid="elsewhere" />} />
          </Routes>
        </MemoryRouter>
      </KanapDialogProvider>
    </QueryClientProvider>,
  );
}

const where = () => screen.getByTestId('where').textContent;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

/** The name given (Enter), the email typed and still in its field. */
function typeDraft() {
  const name = screen.getByLabelText('name');
  act(() => name.focus());
  fireEvent.change(name, { target: { value: 'Ana' } });
  fireEvent.keyDown(name, { key: 'Enter' });
  const email = screen.getByLabelText('email');
  act(() => email.focus());
  fireEvent.change(email, { target: { value: 'ana@example.com' } });
  return email;
}

describe('useDraftCreation on the draft: leaving gives nothing', () => {
  beforeEach(() => {
    resetCreationStore();
  });

  it('writes nothing when the last field loses the focus to a link outside the page', async () => {
    const post = vi.fn(async () => THING);
    renderDraft(post);
    typeDraft();
    const menu = screen.getByRole('link', { name: 'menu' });
    act(() => menu.focus());
    await settle();
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(menu);
    await settle();
    expect(where()).toBe('/elsewhere');
    expect(post).not.toHaveBeenCalled();
  });

  it('writes nothing when the last field loses the focus to the way back, to nowhere or to another window', async () => {
    const post = vi.fn(async () => THING);
    renderDraft(post);
    const email = typeDraft();
    act(() => screen.getByRole('button', { name: 'back' }).focus());
    act(() => email.focus());
    // Nowhere: a click on the page's background, another window or tab.
    fireEvent.blur(email);
    await settle();
    expect(post).not.toHaveBeenCalled();
    expect(where()).toBe('/things/new');
  });

  it('writes the draft when the last field gives way to another field of the page', async () => {
    const post = vi.fn(async () => THING);
    renderDraft(post);
    typeDraft();
    act(() => screen.getByLabelText('phone').focus());
    await waitFor(() => expect(where()).toBe(RECORD_PATH));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ana', email: 'ana@example.com' }));
  });

  it('writes the draft on Enter in the last field', async () => {
    const post = vi.fn(async () => THING);
    renderDraft(post);
    const email = typeDraft();
    fireEvent.keyDown(email, { key: 'Enter' });
    await waitFor(() => expect(where()).toBe(RECORD_PATH));
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('keeps a draft a departure left, and writes it on the next passage to another field', async () => {
    const post = vi.fn(async () => THING);
    renderDraft(post);
    const email = typeDraft();
    fireEvent.blur(email);
    await settle();
    expect(post).not.toHaveBeenCalled();
    act(() => screen.getByLabelText('name').focus());
    act(() => screen.getByLabelText('phone').focus());
    await waitFor(() => expect(where()).toBe(RECORD_PATH));
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('leaves on one click of Cancel, the last field just typed, nothing written', async () => {
    const post = vi.fn(async () => THING);
    renderDraft(post);
    typeDraft();
    const cancel = screen.getByRole('button', { name: 'common:buttons.cancel' });
    fireEvent.pointerDown(cancel);
    act(() => cancel.focus());
    fireEvent.click(cancel);
    await settle();
    expect(where()).toBe('/elsewhere');
    expect(post).not.toHaveBeenCalled();
  });

  it('writes the draft on Create, the press taking the focus from the field being typed', async () => {
    const post = vi.fn(async () => THING);
    renderDraft(post);
    typeDraft();
    const create = screen.getByRole('button', { name: 'common:buttons.create' });
    // The press alone: a browser that gives no focus to a button (Safari) still commits the field.
    fireEvent.pointerDown(create);
    fireEvent.click(create, { detail: 1 });
    await waitFor(() => expect(where()).toBe(RECORD_PATH));
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('does not bring the person back when the write ends after they left, and keeps the record', async () => {
    let answer: (value: DraftCreated) => void = () => undefined;
    const post = vi.fn(() => new Promise<DraftCreated | null>((resolve) => { answer = resolve; }));
    renderDraft(post);
    const email = typeDraft();
    fireEvent.keyDown(email, { key: 'Enter' });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('link', { name: 'menu' }));
    await waitFor(() => expect(where()).toBe('/elsewhere'));
    await act(async () => { answer(THING); });
    await settle();
    expect(where()).toBe('/elsewhere');
    // Kept as any record: nothing says it is being created.
    expect(getCreation(creationKey('things', RECORD_ID))).toBeUndefined();
  });
});

/** A record page on one route for the new record and the created one, never unmounted between them (no key). */
function SameRoutePage({ post }: { post: () => Promise<DraftCreated | null> }) {
  const { id } = useParams();
  const isCreate = id === 'new';
  const navigate = useNavigate();
  const creation = useDraftCreation({
    isCreate,
    family: 'things',
    apiBase: '/things',
    recordId: isCreate ? null : RECORD_ID,
    listPath: '/things',
    recordLabel: 'The thing',
    ready: () => true,
    post,
  });
  return (
    <div>
      <button type="button" onClick={() => creation.create()}>create</button>
      <button type="button" onClick={() => navigate('/things/new')}>new</button>
    </div>
  );
}

describe('useDraftCreation on a page that comes back to a new record', () => {
  beforeEach(() => {
    resetCreationStore();
  });

  it('writes the next draft once the page that wrote one comes back to its new address without unmounting', async () => {
    const post = vi.fn(async () => THING);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={['/things/new']}>
            <Where />
            <Routes>
              <Route path="/things/:id" element={<SameRoutePage post={post} />} />
              <Route path="/things/:id/:tab" element={<SameRoutePage post={post} />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'create' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(RECORD_PATH));
    expect(post).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'new' }));
    expect(screen.getByTestId('where').textContent).toBe('/things/new');
    fireEvent.click(screen.getByRole('button', { name: 'create' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  });
});
