import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import '../../../i18n';
import { ThemeModeProvider, createAppTheme } from '../../../config/ThemeContext';
import TaskPropertiesDrawer from './TaskPropertiesDrawer';

const CATEGORY_DIGITAL = '1f0c2a4e-0000-4000-8000-00000000c001';
const CATEGORY_APPS = '1f0c2a4e-0000-4000-8000-00000000c002';
const STREAM_CUSTOMER = '73e0d9d6-0000-4000-8000-00000000f001';
const STREAM_UNKNOWN = '73e0d9d6-0000-4000-8000-00000000f002';
const CLASSIFICATION = {
  sources: [],
  categories: [
    { id: CATEGORY_DIGITAL, name: 'Digital transformation', is_active: true },
    { id: CATEGORY_APPS, name: 'Business applications', is_active: true },
  ],
  // The project's stream belongs to another category than the project's one.
  streams: [{ id: STREAM_CUSTOMER, name: 'Customer experience', category_id: CATEGORY_APPS, is_active: true }],
};

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn((url: string) => {
      if (url === '/portfolio/classification/all') return Promise.resolve({ data: CLASSIFICATION });
      if (url === '/users/lookup') return Promise.resolve({ data: { items: [], has_more: false } });
      return Promise.resolve({ data: [] });
    }),
  },
}));
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('./DrawerKnowledgeSection', () => ({ default: () => null }));

// A new task takes the project's classification as ids only: the names come from the lists.
const fromProject = (streamId: string) => ({
  id: '',
  status: 'open',
  task_type_id: null,
  priority_level: 'normal',
  owner_ids: [],
  viewer_ids: [],
  labels: [],
  related_object_type: 'project',
  related_object_id: 'p-1',
  related_object_name: 'Fromage-as-a-Service',
  source_id: null,
  source_name: null,
  category_id: CATEGORY_DIGITAL,
  category_name: null,
  stream_id: streamId,
  stream_name: null,
});

function renderDrawer(task: ReturnType<typeof fromProject>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeModeProvider>
        <ThemeProvider theme={createAppTheme('light')}>
          <MemoryRouter>
            <TaskPropertiesDrawer task={task as any} open onToggle={() => {}} onPatch={() => {}} isCreate />
          </MemoryRouter>
        </ThemeProvider>
      </ThemeModeProvider>
    </QueryClientProvider>,
  );
}

/** The property row whose label is `label` (the label box is the direct parent of the text). */
function fieldRow(label: string): HTMLElement {
  const row = screen.getByText(label).parentElement;
  if (!row) throw new Error(`missing row for ${label}`);
  return row;
}

describe('TaskPropertiesDrawer classification of a new project task', () => {
  it('names a stream that lies outside the task category', async () => {
    renderDrawer(fromProject(STREAM_CUSTOMER));
    expect(await within(fieldRow('Stream')).findByText('Customer experience')).toBeTruthy();
    expect(within(fieldRow('Category')).getByText('Digital transformation')).toBeTruthy();
    expect(screen.queryByText(STREAM_CUSTOMER)).toBeNull();
  });

  it('never shows the id of a stream it cannot name', async () => {
    renderDrawer(fromProject(STREAM_UNKNOWN));
    await within(fieldRow('Category')).findByText('Digital transformation');
    fireEvent.mouseDown(within(fieldRow('Stream')).getByRole('combobox'));
    await screen.findByRole('listbox');
    expect(screen.queryByText(STREAM_UNKNOWN)).toBeNull();
  });
});
