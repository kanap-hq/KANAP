import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import TaskDetailHeader from './TaskDetailHeader';
import type { TaskCrumb } from '../taskWorkspaceOrigin';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('./TaskNavChip', () => ({
  default: () => <div data-testid="task-nav-chip" />,
}));

vi.mock('./TaskMetadataBar', () => ({
  default: () => <div data-testid="task-metadata-bar" />,
}));

vi.mock('../../../components/workspace/SendLinkButton', () => ({
  default: () => <button type="button">Share</button>,
}));

vi.mock('../../../components/history/RecordHistoryButton', () => ({
  default: ({ table, recordId }: { table: string; recordId: string }) => (
    <button type="button" data-testid="record-history" data-table={table} data-record={recordId}>History</button>
  ),
}));

const theme = createAppTheme('dark');

const originCrumb: TaskCrumb = {
  key: 'origin',
  label: 'Tasks',
  href: '/portfolio/tasks',
  variant: 'back',
};

const parentCrumb: TaskCrumb = {
  key: 'parent',
  label: 'SAP Cheddar Migration',
  href: '/portfolio/projects/prj-1/summary',
  variant: 'link',
};

function renderHeader(crumbs: TaskCrumb[], handlers?: {
  onOriginClick?: ReturnType<typeof vi.fn<() => void>>;
  onParentClick?: ReturnType<typeof vi.fn<(href: string) => void>>;
  taskId?: string;
}) {
  const onOriginClick = handlers?.onOriginClick ?? vi.fn<() => void>();
  const onParentClick = handlers?.onParentClick ?? vi.fn<(href: string) => void>();
  render(
    <ThemeProvider theme={theme}>
      <TaskDetailHeader
        taskId={handlers?.taskId ?? 'task-1'}
        itemNumber={2}
        title="SAP Cheddar vendor selection"
        status="open"
        priorityLevel="high"
        priorityScore={90}
        assigneeUserId={null}
        assigneeName={null}
        dueDate={null}
        isProjectTask
        hasConvertedRequest={false}
        crumbs={crumbs}
        onOriginClick={onOriginClick}
        onParentClick={onParentClick}
        currentIndex={0}
        totalCount={1}
        hasPrev={false}
        hasNext={false}
        onPrev={() => undefined}
        onNext={() => undefined}
        onClose={() => undefined}
        onConvertToRequest={() => undefined}
        onDelete={() => undefined}
        onTitleChange={() => undefined}
        onTitleSave={() => undefined}
        onMetadataPatch={() => undefined}
        canManage
        canDelete
        canConvertToRequest
      />
    </ThemeProvider>,
  );
  return { onOriginClick, onParentClick };
}

describe('TaskDetailHeader history', () => {
  it('opens the task history from the header, between the share and convert actions', () => {
    renderHeader([originCrumb]);
    const history = screen.getByTestId('record-history');
    expect(history).toHaveAttribute('data-table', 'tasks');
    expect(history).toHaveAttribute('data-record', 'task-1');
    const share = screen.getByRole('button', { name: 'Share' });
    const convert = screen.getByRole('button', { name: 'portfolio:actions.convertToRequest' });
    expect(share.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(history.compareDocumentPosition(convert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('has no history while the task is being created', () => {
    renderHeader([originCrumb], { taskId: 'new' });
    expect(screen.queryByTestId('record-history')).not.toBeInTheDocument();
  });
});

describe('TaskDetailHeader breadcrumbs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the origin crumb only when there is no parent', () => {
    renderHeader([originCrumb]);
    const origin = screen.getByRole('link', { name: '← Tasks' });
    expect(origin).toHaveAttribute('href', '/portfolio/tasks');
    expect(screen.queryByRole('link', { name: 'SAP Cheddar Migration' })).not.toBeInTheDocument();
  });

  it('renders a clickable parent crumb with its href', () => {
    renderHeader([originCrumb, parentCrumb]);
    const parent = screen.getByRole('link', { name: 'SAP Cheddar Migration' });
    expect(parent).toHaveAttribute('href', '/portfolio/projects/prj-1/summary');
  });

  it('calls onOriginClick on a plain left click and keeps modifier clicks native', () => {
    const { onOriginClick } = renderHeader([originCrumb]);
    const origin = screen.getByRole('link', { name: '← Tasks' });
    fireEvent.click(origin);
    expect(onOriginClick).toHaveBeenCalledTimes(1);

    onOriginClick.mockClear();
    fireEvent.click(origin, { metaKey: true });
    expect(onOriginClick).not.toHaveBeenCalled();
  });

  it('calls onParentClick with the parent href on a plain left click', () => {
    const { onParentClick } = renderHeader([originCrumb, parentCrumb]);
    fireEvent.click(screen.getByRole('link', { name: 'SAP Cheddar Migration' }));
    expect(onParentClick).toHaveBeenCalledWith('/portfolio/projects/prj-1/summary');
  });

  it('makes the title a button that opens on Enter', () => {
    renderHeader([originCrumb]);
    const title = screen.getByRole('button', { name: 'common:buttons.editTitle' });
    expect(title).toHaveTextContent('SAP Cheddar vendor selection');
    fireEvent.keyDown(title, { key: 'Enter' });
    expect(screen.getByRole('textbox', { name: 'common:buttons.editTitle' })).toHaveValue('SAP Cheddar vendor selection');
  });
});
