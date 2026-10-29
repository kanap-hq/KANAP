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
  onTabChange?: ReturnType<typeof vi.fn<(tab: string) => void>>;
  activeTab?: string;
}) {
  const onOriginClick = handlers?.onOriginClick ?? vi.fn<() => void>();
  const onParentClick = handlers?.onParentClick ?? vi.fn<(href: string) => void>();
  const onTabChange = handlers?.onTabChange ?? vi.fn<(tab: string) => void>();
  render(
    <ThemeProvider theme={theme}>
      <TaskDetailHeader
        taskId="task-1"
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
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'history', label: 'History' },
        ]}
        activeTab={handlers?.activeTab ?? 'overview'}
        onTabChange={onTabChange}
      />
    </ThemeProvider>,
  );
  return { onOriginClick, onParentClick, onTabChange };
}

describe('TaskDetailHeader tabs', () => {
  it('draws the Overview and History tabs, History last, and no History button among the actions', () => {
    renderHeader([originCrumb]);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Overview', 'History']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', { name: 'History' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'portfolio:actions.convertToRequest' })).toBeInTheDocument();
  });

  it('marks the active tab and reports a tab change', () => {
    const { onTabChange } = renderHeader([originCrumb], { activeTab: 'history' });
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(onTabChange).toHaveBeenCalledWith('overview');
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
