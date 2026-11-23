import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import { KanapDialogProvider } from '../../design';
import { PropertyRow } from '../../design/PropertyRow';
import PortfolioDetailWorkspaceShell from '../../../pages/portfolio/workspace/PortfolioDetailWorkspaceShell';
import { resetCreationStore } from './creationStore';
import { clearCreationFieldFocus } from './creationFieldFocus';
import CreationActions from './CreationActions';
import CreationPreview from './CreationPreview';
import useRecordCreation from './useRecordCreation';
import useTitleCreation from './useTitleCreation';
import useDraftCreation from './useDraftCreation';
import useCreationTitle from './useCreationTitle';

const stableT = vi.hoisted(() => (key: string) => key);
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

const ID = '5f1d7a2e-0000-4000-8000-000000000007';
const TITLE_FIELD = 'Untitled';

type Post = (name: string) => Promise<{ id: string; creation_token: string }>;

/**
 * What the record shows once created. `description`: the description is declared and may be
 * changed (`editable`), declared and shown read only (`readonly`), or on another tab (`elsewhere`).
 */
type Shape = { description?: 'editable' | 'readonly' | 'elsewhere' };

function RecordBody({ description = 'editable' }: Shape) {
  if (description === 'elsewhere') return <input aria-label="budget amount" />;
  return (
    <div data-creation-description="">
      <textarea aria-label="description" readOnly={description === 'readonly'} />
    </div>
  );
}

const properties = (
  <div>
    <PropertyRow label="Code"><input aria-label="code" readOnly value="X-1" /></PropertyRow>
    <PropertyRow label="Category"><input aria-label="category" /></PropertyRow>
  </div>
);

/** A record created at its title, on the shared shell, as the seven title families are. */
function TitlePage({ post, shape }: { post: Post; shape: Shape }) {
  const { id = 'new' } = useParams();
  const isCreate = id === 'new';
  const navigate = useNavigate();
  const creation = useRecordCreation({ family: 'things', apiBase: '/things', recordId: isCreate ? null : id, listPath: '/things', recordLabel: 'The thing' });
  const title = useTitleCreation<{ id: string }>({
    isCreate,
    requiredMessage: 'required',
    post,
    onCreated: (created, token) => {
      creation.startCreation({ recordId: created.id, token, returnTo: '/things' });
      navigate(`/things/${created.id}`, { replace: true });
    },
    errorMessage: () => 'refused',
  });
  const showActions = isCreate || creation.beingCreated;
  return (
    <PortfolioDetailWorkspaceShell
      activeTab={shape.description === 'elsewhere' ? 'budget' : 'overview'}
      tabs={[{ key: 'overview', label: 'Overview' }, { key: 'budget', label: 'Budget' }]}
      onTabChange={() => undefined}
      drawerStorageKey="kanap.test.drawerOpen"
      backLabel="Back"
      onBack={() => navigate('/things')}
      isCreate={isCreate}
      title={isCreate ? '' : 'Billing'}
      titleFallback={TITLE_FIELD}
      canEditTitle
      titleAutoEdit={isCreate}
      onTitleSave={isCreate ? title.commit : undefined}
      onTitleDraftChange={isCreate ? title.onTitleDraftChange : undefined}
      titleError={isCreate ? title.titleError : null}
      titleFocusRequest={title.focusRequest}
      actions={showActions ? (
        <CreationActions
          onCreate={isCreate ? title.create : creation.finishCreation}
          onCancel={() => navigate('/things')}
          done={!isCreate}
          writing={title.writing}
        />
      ) : null}
      properties={isCreate ? <CreationPreview>{properties}</CreationPreview> : properties}
    >
      {isCreate ? <CreationPreview><RecordBody {...shape} /></CreationPreview> : <RecordBody {...shape} />}
    </PortfolioDetailWorkspaceShell>
  );
}

/** A record written from its draft once its owner is chosen, as every other family is. */
function DraftPage({ post, shape }: { post: Post; shape: Shape }) {
  const { id = 'new' } = useParams();
  const isCreate = id === 'new';
  const navigate = useNavigate();
  const [owner, setOwner] = React.useState('');
  const ownerRef = React.useRef(owner);
  ownerRef.current = owner;
  const draftRef = React.useRef<{ attempt: () => void } | null>(null);
  const title = useCreationTitle({ requiredMessage: 'required', onCancel: () => navigate('/things'), onCommit: () => draftRef.current?.attempt() });
  const creation = useDraftCreation({
    isCreate,
    family: 'things',
    apiBase: '/things',
    recordId: isCreate ? null : id,
    listPath: '/things',
    recordLabel: 'The thing',
    ready: () => !!title.current().trim() && !!ownerRef.current,
    post: async () => {
      const created = await post(title.current().trim());
      return { id: created.id, token: created.creation_token, path: `/things/${created.id}` };
    },
    missing: () => (ownerRef.current ? [] : ['owner']),
  });
  draftRef.current = creation;
  const { attempt } = creation;
  React.useEffect(() => { if (owner) attempt(); }, [attempt, owner]);
  return (
    <PortfolioDetailWorkspaceShell
      activeTab="overview"
      tabs={[{ key: 'overview', label: 'Overview' }]}
      onTabChange={() => undefined}
      drawerStorageKey="kanap.test.drawerOpen"
      backLabel="Back"
      onBack={() => navigate('/things')}
      isCreate={isCreate}
      titleFallback={TITLE_FIELD}
      {...(isCreate ? title.shellProps : { title: 'Billing', canEditTitle: true })}
      actions={isCreate || creation.beingCreated ? (
        <CreationActions
          onCreate={() => creation.create(title.require)}
          onCancel={() => navigate('/things')}
          done={!isCreate}
          writing={creation.writing}
        />
      ) : null}
      properties={(
        <div>
          <PropertyRow label="Owner" required>
            <select aria-label="owner" value={isCreate ? owner : 'ana'} onChange={(event) => setOwner(event.target.value)}>
              <option value="">-</option>
              <option value="ana">Ana</option>
            </select>
          </PropertyRow>
          <PropertyRow label="Category"><input aria-label="category" /></PropertyRow>
        </div>
      )}
    >
      <RecordBody {...shape} />
    </PortfolioDetailWorkspaceShell>
  );
}

function Where() {
  const navigate = useNavigate();
  return (
    <>
      <div data-testid="where">{useLocation().pathname}</div>
      {/* A link elsewhere in the application to a record that exists. */}
      <button type="button" onClick={() => navigate(`/things/${ID}`)}>open the record</button>
    </>
  );
}

function renderPage(Page: typeof TitlePage, { post, shape = {}, at = '/things/new' }: { post: Post; shape?: Shape; at?: string }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={queryClient}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={['/things', at]} initialIndex={1}>
            {/* The application's own field, outside the record page. */}
            <input aria-label="search" />
            <Routes>
              <Route path="/things" element={<div>list</div>} />
              <Route path="/things/:id" element={<Page post={post} shape={shape} />} />
            </Routes>
            <Where />
          </MemoryRouter>
        </KanapDialogProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const created: Post = async () => ({ id: ID, creation_token: 'token-1' });

function typeTitle(name: string) {
  const title = screen.getByRole('textbox', { name: TITLE_FIELD });
  act(() => title.focus());
  fireEvent.change(title, { target: { value: name } });
  return title;
}

async function onRecord() {
  await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`/things/${ID}`));
}

describe('the cursor once the creation frame has written a record', () => {
  beforeEach(() => resetCreationStore());
  afterEach(() => clearCreationFieldFocus());

  it('goes to the description when Enter in the title created the record', async () => {
    renderPage(TitlePage, { post: created });
    fireEvent.keyDown(typeTitle('Billing'), { key: 'Enter' });
    await onRecord();
    await waitFor(() => expect(screen.getByLabelText('description')).toHaveFocus());
  });

  it('goes to the description when Tab from the title created the record', async () => {
    const user = userEvent.setup();
    renderPage(TitlePage, { post: created });
    typeTitle('Billing');
    await user.tab();
    await onRecord();
    await waitFor(() => expect(screen.getByLabelText('description')).toHaveFocus());
  });

  it('goes to the description when Create created the record', async () => {
    const user = userEvent.setup();
    renderPage(TitlePage, { post: created });
    typeTitle('Billing');
    await user.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await onRecord();
    await waitFor(() => expect(screen.getByLabelText('description')).toHaveFocus());
  });

  it('goes to the description when the choice of the last required field wrote the draft', async () => {
    const user = userEvent.setup();
    renderPage(DraftPage, { post: created });
    const title = typeTitle('Billing');
    fireEvent.keyDown(title, { key: 'Enter' });
    await user.selectOptions(screen.getByLabelText('owner'), 'ana');
    await onRecord();
    await waitFor(() => expect(screen.getByLabelText('description')).toHaveFocus());
  });

  it('places no cursor on a record opened as it is', async () => {
    renderPage(TitlePage, { post: created, at: `/things/${ID}` });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(screen.getByLabelText('description')).not.toHaveFocus();
    expect(screen.getByLabelText('category')).not.toHaveFocus();
  });

  it('leaves the cursor in the title when the write is refused, and places none on the next record opened', async () => {
    const user = userEvent.setup();
    const refused: Post = async () => { throw new Error('taken'); };
    renderPage(TitlePage, { post: refused });
    typeTitle('Billing');
    await user.tab();
    expect(await screen.findByText('refused')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: TITLE_FIELD })).toHaveFocus();
    // The person opens a record instead (a link, which takes no focus): it opens as any record.
    fireEvent.click(screen.getByRole('button', { name: 'open the record' }));
    await onRecord();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(screen.getByLabelText('description')).not.toHaveFocus();
  });

  it('leaves the cursor in a field the person went to while the record was written', async () => {
    let answer: (value: { id: string; creation_token: string }) => void = () => undefined;
    const slow: Post = () => new Promise((resolve) => { answer = resolve; });
    renderPage(TitlePage, { post: slow });
    fireEvent.keyDown(typeTitle('Billing'), { key: 'Enter' });
    const search = screen.getByLabelText('search');
    act(() => search.focus());
    await act(async () => answer({ id: ID, creation_token: 'token-1' }));
    await onRecord();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(search).toHaveFocus();
  });

  it('leaves the cursor in the field the person goes on using while the record is written', async () => {
    const user = userEvent.setup();
    let answer: (value: { id: string; creation_token: string }) => void = () => undefined;
    const slow: Post = () => new Promise((resolve) => { answer = resolve; });
    renderPage(DraftPage, { post: slow });
    fireEvent.keyDown(typeTitle('Billing'), { key: 'Enter' });
    const owner = screen.getByLabelText('owner');
    await user.selectOptions(owner, 'ana');
    // The record is being written: the person opens the list again.
    fireEvent.mouseDown(owner);
    await act(async () => answer({ id: ID, creation_token: 'token-1' }));
    await onRecord();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(screen.getByLabelText('owner')).toHaveFocus();
  });

  it('goes to the first field the person may change when the description is read only', async () => {
    renderPage(TitlePage, { post: created, shape: { description: 'readonly' } });
    fireEvent.keyDown(typeTitle('Billing'), { key: 'Enter' });
    await onRecord();
    await waitFor(() => expect(screen.getByLabelText('category')).toHaveFocus());
  });

  it('goes to the first field shown when the description is on another tab, without changing tab', async () => {
    renderPage(TitlePage, { post: created, shape: { description: 'elsewhere' } });
    fireEvent.keyDown(typeTitle('Billing'), { key: 'Enter' });
    await onRecord();
    await waitFor(() => expect(screen.getByLabelText('budget amount')).toHaveFocus());
    expect(screen.getByRole('tab', { name: 'Budget' })).toHaveAttribute('aria-selected', 'true');
  });
});

