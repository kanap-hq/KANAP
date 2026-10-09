import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../../config/ThemeContext';
import ProjectEffortTab from './ProjectEffortTab';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      language: 'en',
      resolvedLanguage: 'en',
    },
    ready: true,
  }),
}));

vi.mock('../../../../api', () => ({
  default: {
    delete: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

vi.mock('../../../../i18n/useLocale', () => ({
  useLocale: () => 'en-GB',
}));

vi.mock('../../../../components/design', () => ({
  useKanapDialogs: () => ({
    confirm: vi.fn(async () => true),
  }),
}));

vi.mock('../../components/EffortAllocationDialog', () => ({
  default: () => null,
}));

vi.mock('../../components/LogTimeDialog', () => ({
  default: () => null,
}));

const theme = createAppTheme('light');

const baseForm = {
  id: 'project-1',
  execution_progress: 25,
  estimated_effort_it: 12,
  estimated_effort_business: 8,
  actual_effort_it: 0,
  actual_effort_business: 0,
  baseline_effort_it: null,
  baseline_effort_business: null,
  time_entries: [],
  it_lead_id: null,
  it_lead: null,
  it_team: [],
  business_lead_id: null,
  business_lead: null,
  business_team: [],
};

function renderEffortTab({
  canManage = true,
  form = baseForm,
  onUpdate = vi.fn<(patch: any) => void>(),
}: {
  canManage?: boolean;
  form?: any;
  onUpdate?: ReturnType<typeof vi.fn<(patch: any) => void>>;
} = {}) {
  const result = render(
    <ThemeProvider theme={theme}>
      <ProjectEffortTab
        businessAllocationData={null}
        canContributeToProject
        canManage={canManage}
        canProjectAdmin={canManage}
        form={form}
        itAllocationData={null}
        onError={vi.fn()}
        onRefetch={vi.fn(async () => undefined)}
        onRefetchBusinessAlloc={vi.fn(async () => undefined)}
        onRefetchItAlloc={vi.fn(async () => undefined)}
        onUpdate={onUpdate}
        profileId="user-1"
        projectId="project-1"
        taskTimeEntries={[]}
        taskTimeSummary={{ it_hours: 0, business_hours: 0, total_hours: 0 }}
      />
    </ThemeProvider>,
  );

  return { ...result, onUpdate };
}

describe('ProjectEffortTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the effort controls with mocked update props', () => {
    renderEffortTab();

    expect(screen.getByLabelText('IT estimated effort in MD')).toHaveValue(12);
    expect(screen.getByLabelText('Business estimated effort in MD')).toHaveValue(8);
    expect(screen.getByRole('slider')).toBeInTheDocument();
  });

  it('commits the IT estimate once on blur and not per keystroke', () => {
    const onUpdate = vi.fn();
    renderEffortTab({ onUpdate });

    const input = screen.getByLabelText('IT estimated effort in MD');
    fireEvent.change(input, { target: { value: '14' } });
    fireEvent.change(input, { target: { value: '145' } });

    expect(onUpdate).not.toHaveBeenCalled();

    fireEvent.blur(input);

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith({ estimated_effort_it: 145 });
  });

  it('commits the IT estimate once when Enter blurs the input', () => {
    const onUpdate = vi.fn();
    renderEffortTab({ onUpdate });

    const input = screen.getByLabelText('IT estimated effort in MD');
    input.focus();
    fireEvent.change(input, { target: { value: '16' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith({ estimated_effort_it: 16 });
  });

  it('commits null when the IT estimate is cleared', () => {
    const onUpdate = vi.fn();
    renderEffortTab({ onUpdate });

    const input = screen.getByLabelText('IT estimated effort in MD');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith({ estimated_effort_it: null });
  });

  it('reverts invalid IT estimates without committing', () => {
    const onUpdate = vi.fn();
    renderEffortTab({ onUpdate });

    const input = screen.getByLabelText('IT estimated effort in MD');
    fireEvent.change(input, { target: { value: '-5' } });
    fireEvent.blur(input);

    expect(onUpdate).not.toHaveBeenCalled();
    expect(input).toHaveValue(12);
  });

  it('preserves an uncommitted IT draft when unrelated form fields rerender', () => {
    const onUpdate = vi.fn();
    const { rerender } = renderEffortTab({ onUpdate });

    const input = screen.getByLabelText('IT estimated effort in MD');
    fireEvent.change(input, { target: { value: '123' } });

    rerender(
      <ThemeProvider theme={theme}>
        <ProjectEffortTab
          businessAllocationData={null}
          canContributeToProject
          canManage
          canProjectAdmin
          form={{ ...baseForm, name: 'Updated project name' }}
          itAllocationData={null}
          onError={vi.fn()}
          onRefetch={vi.fn(async () => undefined)}
          onRefetchBusinessAlloc={vi.fn(async () => undefined)}
          onRefetchItAlloc={vi.fn(async () => undefined)}
          onUpdate={onUpdate}
          profileId="user-1"
          projectId="project-1"
          taskTimeEntries={[]}
          taskTimeSummary={{ it_hours: 0, business_hours: 0, total_hours: 0 }}
        />
      </ThemeProvider>,
    );

    expect(screen.getByLabelText('IT estimated effort in MD')).toHaveValue(123);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('disables the estimate input and progress slider when the user cannot manage', () => {
    renderEffortTab({ canManage: false });

    expect(screen.getByLabelText('IT estimated effort in MD')).toBeDisabled();
    expect(screen.getByRole('slider')).toBeDisabled();
  });
});
