import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KanapDialogProvider } from '../../components/design';
import api from '../../api';
import TaskWorkspacePage from './TaskWorkspacePage';

const translationMock = vi.hoisted(() => {
  let revision = 0;
  const listeners = new Set<() => void>();

  return {
    reset() {
      revision = 0;
      listeners.clear();
    },
    emitLanguageChange() {
      revision += 1;
      listeners.forEach((listener) => listener());
    },
    getRevision() {
      return revision;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

const queryClientMock = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
}));

const taskQueryMock = vi.hoisted(() => ({
  task: undefined as any,
  isLoading: false,
  refetch: vi.fn(async () => undefined),
}));

vi.mock('react-i18next', async () => {
  const React = await import('react');

  return {
    initReactI18next: {
      type: '3rdParty',
      init: () => undefined,
    },
    useTranslation: () => {
      const [, forceRender] = React.useReducer((value: number) => value + 1, 0);
      React.useEffect(() => translationMock.subscribe(() => forceRender()), []);
      const revision = translationMock.getRevision();
      return {
        t: (key: string) => `${key}__${revision}`,
        i18n: {
          language: 'en',
          resolvedLanguage: 'en',
        },
        ready: true,
      };
    },
  };
});

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    if (Array.isArray(queryKey) && queryKey[0] === 'tasks' && queryKey.length === 2 && queryKey[1] !== 'new') {
      return {
        data: taskQueryMock.task,
        isLoading: taskQueryMock.isLoading,
        refetch: taskQueryMock.refetch,
      };
    }
    if (Array.isArray(queryKey) && queryKey[0] === 'portfolio-task-types') {
      return {
        data: [
          { id: 'task-type', name: 'Task', is_active: true },
        ],
        isLoading: false,
        refetch: vi.fn(),
      };
    }
    return {
      data: undefined,
      isLoading: false,
      refetch: vi.fn(),
    };
  },
  useQueryClient: () => queryClientMock,
}));

vi.mock('../../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: () => true,
    profile: { id: 'user-1' },
  }),
}));

vi.mock('../../tenant/TenantContext', () => ({
  useTenant: () => ({
    tenantSlug: 'tenant-a',
  }),
}));

vi.mock('../workspace/hooks/useRecentlyViewed', () => ({
  useRecentlyViewed: () => ({
    addToRecent: vi.fn(),
  }),
}));

vi.mock('../../hooks/useClassificationDefaults', () => ({
  useClassificationDefaults: () => ({
    data: null,
    isLoading: false,
  }),
}));

vi.mock('../../hooks/useTaskNav', () => ({
  useTaskNav: () => ({
    total: 0,
    index: 0,
    hasPrev: false,
    hasNext: false,
    prevId: null,
    nextId: null,
  }),
}));

vi.mock('./components/TaskSidebar', () => ({
  default: () => <div data-testid="task-sidebar" />,
}));

vi.mock('./components/TaskDetailHeader', () => ({
  default: () => <div data-testid="task-detail-header" />,
}));

vi.mock('./components/TaskPropertiesDrawer', () => ({
  default: ({ onRelationChange, onPatch }: { onRelationChange?: (params: any) => void; onPatch?: (patch: any) => void }) => (
    <div data-testid="task-properties-drawer">
      <button type="button" onClick={() => onPatch?.({ assignee_user_id: 'user-2' })}>Hand over</button>
      <button
        type="button"
        onClick={() => onRelationChange?.({ type: 'project', id: 'project-b', name: 'Project B' })}
      >
        Move to project B
      </button>
      <button
        type="button"
        onClick={() => onRelationChange?.({ type: null, id: null, name: null })}
      >
        Make standalone
      </button>
    </div>
  ),
}));

vi.mock('../../components/ExportButton', () => ({
  default: () => <button type="button">Export</button>,
}));

vi.mock('../../components/ImportButton', () => ({
  default: () => <button type="button">Import</button>,
}));

vi.mock('../../components/ShareDialog', () => ({
  default: () => null,
}));

vi.mock('./components/ConvertToRequestDialog', () => ({
  default: () => null,
}));

vi.mock('./components/TaskActivity', () => ({
  default: () => null,
}));

vi.mock('./components/TaskAttachments', () => ({
  default: () => null,
}));

vi.mock('../../components/MarkdownEditor', () => ({
  default: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  }) => (
    <textarea
      aria-label="Task description"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, String(value));
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
  };
}

function renderCreatePage() {
  return render(
    <KanapDialogProvider>
      <MemoryRouter initialEntries={['/portfolio/tasks/new/overview']}>
        <Routes>
          <Route path="/portfolio/tasks/:id/:tab" element={<TaskWorkspacePage />} />
        </Routes>
      </MemoryRouter>
    </KanapDialogProvider>,
  );
}

function renderEditPage(initialEntry = '/portfolio/tasks/task-1/overview') {
  return render(
    <KanapDialogProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/portfolio/tasks/:id/:tab" element={<TaskWorkspacePage />} />
        </Routes>
      </MemoryRouter>
    </KanapDialogProvider>,
  );
}

function makeTask(overrides: Record<string, any> = {}) {
  return {
    id: 'task-1',
    item_number: 1,
    title: 'Move me',
    description: null,
    status: 'open',
    task_type_id: null,
    task_type_name: null,
    priority_level: 'normal',
    priority_score: 0,
    start_date: null,
    due_date: null,
    assignee_user_id: null,
    assignee_name: null,
    creator_id: null,
    creator_name: null,
    owner_ids: [],
    viewer_ids: [],
    labels: [],
    application_ids: [],
    asset_ids: [],
    related_object_type: 'project',
    related_object_id: 'project-a',
    related_object_name: 'Project A',
    phase_id: 'phase-a',
    phase_name: 'Phase A',
    source_id: null,
    source_name: null,
    category_id: null,
    category_name: null,
    stream_id: null,
    stream_name: null,
    company_id: null,
    company_name: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('TaskWorkspacePage create mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    translationMock.reset();
    taskQueryMock.task = undefined;
    taskQueryMock.isLoading = false;
    taskQueryMock.refetch.mockReset();
    taskQueryMock.refetch.mockResolvedValue(undefined);

    const localStorageMock = createLocalStorageMock();
    vi.stubGlobal('localStorage', localStorageMock);
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('preserves an in-progress draft when the language changes', async () => {
    renderCreatePage();

    const titlePlaceholder = 'portfolio:workspace.task.title.placeholder__0';
    const descriptionPlaceholder = 'portfolio:workspace.task.description.placeholder__0';

    const titleInput = await screen.findByPlaceholderText(titlePlaceholder);
    // The description editor mounts after the title field: wait for it too.
    const descriptionInput = await screen.findByPlaceholderText(descriptionPlaceholder);

    fireEvent.change(titleInput, { target: { value: 'Investigate disappearing draft' } });
    fireEvent.change(descriptionInput, { target: { value: 'The form should keep this text.' } });

    act(() => {
      translationMock.emitLanguageChange();
    });

    expect(screen.getByDisplayValue('Investigate disappearing draft')).toBeInTheDocument();
    expect(screen.getByDisplayValue('The form should keep this text.')).toBeInTheDocument();
  });
});

describe('TaskWorkspacePage relation changes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    translationMock.reset();
    taskQueryMock.task = makeTask();
    taskQueryMock.isLoading = false;
    taskQueryMock.refetch.mockReset();
    taskQueryMock.refetch.mockResolvedValue(undefined);
    vi.mocked(api.patch).mockResolvedValue({ data: {} } as any);

    const localStorageMock = createLocalStorageMock();
    vi.stubGlobal('localStorage', localStorageMock);
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    window.localStorage.setItem('kanap.taskDetail.drawerOpen', 'true');

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('uses the global move endpoint when moving a task into another project', async () => {
    renderEditPage();

    fireEvent.click(await screen.findByText('Move to project B'));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/tasks/task-1/move', {
        related_object_type: 'project',
        related_object_id: 'project-b',
        phase_id: null,
      });
    });
    expect(api.patch).not.toHaveBeenCalledWith('/portfolio/projects/project-b/tasks/task-1', expect.anything());
  });

  it('says the person still follows a task they handed over without reading its line', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: { id: 'task-1', stillFollowing: true } } as any);
    renderEditPage();
    fireEvent.click(await screen.findByText('Hand over'));
    expect(await screen.findByTestId('task-still-following')).toHaveTextContent('portfolio:workspace.task.messages.stillFollowing');
  });

  it('says nothing more after an ordinary hand over', async () => {
    renderEditPage();
    fireEvent.click(await screen.findByText('Hand over'));
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    expect(screen.queryByTestId('task-still-following')).toBeNull();
  });

  it('saves a task whose budget line the person cannot read, which comes without its id', async () => {
    taskQueryMock.task = makeTask({
      related_object_type: 'spend_item',
      related_object_id: null,
      related_object_name: 'BL-12',
      related_object_hidden: true,
      phase_id: null,
      phase_name: null,
    });
    renderEditPage();
    fireEvent.click(await screen.findByText('Hand over'));
    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/tasks/task-1', { assignee_user_id: 'user-2' });
    });
    expect(screen.queryByText(/relatedItemRequired/)).toBeNull();
  });

  it('uses the global move endpoint when making a project task standalone', async () => {
    renderEditPage();

    fireEvent.click(await screen.findByText('Make standalone'));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/tasks/task-1/move', {
        related_object_type: null,
        related_object_id: null,
        phase_id: null,
      });
    });
  });

  it('keeps the current workspace rendered while the next task is loading', async () => {
    taskQueryMock.task = makeTask({ id: 'task-1', item_number: 1, title: 'Previous task' });
    taskQueryMock.isLoading = true;

    renderEditPage('/portfolio/tasks/T-2/overview');

    expect(screen.queryByText('portfolio:workspace.task.messages.loading__0')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByText('Move to project B'));
    expect(api.patch).not.toHaveBeenCalled();
  });
});
