import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KanapDialogProvider } from '../../design';
import { resetCreationStore } from './creationStore';
import useCreatedFromDraft from './useCreatedFromDraft';
import useDraftCreation, { type DraftCreated } from './useDraftCreation';

const stableT = vi.hoisted(() => (key: string) => key);

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

const RECORD_ID = '5f1d7a2e-0000-4000-8000-000000000005';
let mounts = 0;
let created: DraftCreated;

function Editor({ id }: { id: string }) {
  const isCreate = id === 'new';
  const [title, setTitle] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const titleRef = React.useRef(title);
  titleRef.current = title;
  React.useEffect(() => { mounts += 1; }, []);
  const creation = useDraftCreation({
    isCreate,
    family: 'things',
    apiBase: '/things',
    recordId: isCreate ? null : RECORD_ID,
    listPath: '/things',
    recordLabel: 'The thing',
    ready: () => !!titleRef.current.trim(),
    post: async () => created,
  });
  return (
    <div>
      <input aria-label="title" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => creation.attempt()} />
      <input aria-label="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div data-testid="state">{creation.beingCreated ? 'being created' : 'kept'}</div>
    </div>
  );
}

function Page() {
  const { id = '' } = useParams();
  const fromDraft = useCreatedFromDraft('things', id);
  return <Editor key={fromDraft || id === 'new' ? 'draft' : id} id={id} />;
}

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderNew() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <KanapDialogProvider>
        <MemoryRouter initialEntries={['/things/new/overview']}>
          <Where />
          <Routes>
            <Route path="/things/:id/:tab" element={<Page />} />
          </Routes>
        </MemoryRouter>
      </KanapDialogProvider>
    </QueryClientProvider>,
  );
}

async function typeWhileCreated(path: string) {
  renderNew();
  const title = screen.getByLabelText('title');
  fireEvent.change(title, { target: { value: 'Widget' } });
  const notes = screen.getByLabelText('notes');
  act(() => notes.focus());
  fireEvent.change(notes, { target: { value: 'Ma' } });
  await act(async () => { fireEvent.blur(title); });
  act(() => notes.focus());
  await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(path));
  return notes as HTMLInputElement;
}

describe('useCreatedFromDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCreationStore();
    mounts = 0;
  });

  it('keeps the editor when the created record opens by its reference: same field, same focus, still being created', async () => {
    created = { id: RECORD_ID, token: 'tok', path: '/things/THG-5/overview', reference: 'THG-5' };
    const notes = await typeWhileCreated('/things/THG-5/overview');

    const shown = screen.getByLabelText('notes') as HTMLInputElement;
    expect(shown === notes).toBe(true);
    expect(document.activeElement === shown).toBe(true);
    expect(shown.value).toBe('Ma');
    fireEvent.change(shown, { target: { value: 'Main' } });
    expect(shown.value).toBe('Main');
    expect(mounts).toBe(1);
    expect(screen.getByTestId('state')).toHaveTextContent('being created');
  });

  it('finds the reference whatever its case, as the address may write it', async () => {
    created = { id: RECORD_ID, token: 'tok', path: '/things/thg-5/overview', reference: 'THG-5' };
    const notes = await typeWhileCreated('/things/thg-5/overview');
    expect(screen.getByLabelText('notes') === notes).toBe(true);
    expect(mounts).toBe(1);
  });

  it('still keeps the editor when the created record opens by its uuid', async () => {
    created = { id: RECORD_ID, token: 'tok', path: `/things/${RECORD_ID}/overview`, reference: 'THG-5' };
    const notes = await typeWhileCreated(`/things/${RECORD_ID}/overview`);
    expect(screen.getByLabelText('notes') === notes).toBe(true);
    expect(mounts).toBe(1);
    expect(screen.getByTestId('state')).toHaveTextContent('being created');
  });
});
