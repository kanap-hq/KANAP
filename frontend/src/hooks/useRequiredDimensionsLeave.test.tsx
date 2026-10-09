import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';
import type { AnalyticsAxis } from '../services/analytics';

// A stable `t` (a new one each render loops effects); the message shows the names it was given.
const translation = vi.hoisted(() => ({
  t: (key: string, options?: { names?: string }) => (options?.names ? `${key}: ${options.names}` : key),
  i18n: { language: 'en', resolvedLanguage: 'en' },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => translation }));

import { buildAnalyticsAxes } from './useAnalyticsAxes';
import { useRequiredDimensionsLeave } from './useRequiredDimensionsLeave';

const axis = (id: string, name: string, extra: Partial<AnalyticsAxis> = {}): AnalyticsAxis => ({
  id, code: id, name, description: null, sort_order: 0, is_default: false, applies_to: null,
  required: true, status: 'enabled', disabled_at: null, ...extra,
} as AnalyticsAxis);

const MENU = axis('axis-menu', 'Menu', { sort_order: 1 });
const NATURE = axis('axis-nature', 'Nature', { sort_order: 2 });
const OPTIONAL = axis('axis-optional', 'Optional', { sort_order: 3, required: false });
const CAPEX_ONLY = axis('axis-capex', 'Capex only', { sort_order: 4, applies_to: 'capex' });
const DISABLED = axis('axis-old', 'Old', { sort_order: 5, status: 'disabled', disabled_at: '2020-01-01T00:00:00.000Z' });

type Leave = ReturnType<typeof useRequiredDimensionsLeave>;
type Props = { lineId: string | null; canEdit?: boolean; axes: AnalyticsAxis[]; values: Record<string, string | null> };

function setup(initial: Props) {
  const current: { leave: Leave | null } = { leave: null };
  function Harness({ lineId, canEdit = true, axes, values }: Props) {
    const root = React.useRef<HTMLDivElement | null>(null);
    // The page's dimensions: scoped to OPEX lines, as `useAnalyticsAxes({ scope: 'opex' })` gives them.
    const dimensions = React.useMemo(() => buildAnalyticsAxes(axes, translation.t as unknown as TFunction, true, false, undefined, 'opex'), [axes]);
    const leave = useRequiredDimensionsLeave({ scope: 'opex', lineId, canEdit, axes: dimensions, values: () => values, root });
    current.leave = leave;
    return (
      <div ref={root}>
        <span data-testid="drawer-request">{leave.drawerOpenRequest}</span>
        {dimensions.enabled.map((dimension) => (
          <div key={dimension.id} data-analytics-axis={dimension.id}><input aria-label={dimension.name ?? ''} /></div>
        ))}
        {leave.dialog}
      </div>
    );
  }
  const theme = createAppTheme('light');
  const view = render(<ThemeProvider theme={theme}><Harness {...initial} /></ThemeProvider>);
  return {
    leave: () => current.leave!,
    rerender: (props: Props) => view.rerender(<ThemeProvider theme={theme}><Harness {...props} /></ThemeProvider>),
  };
}

/** Starts asking; the answer comes once a button is clicked. */
function ask(leave: Leave): { answer: Promise<boolean> } {
  let answer!: Promise<boolean>;
  act(() => { answer = leave.confirm(); });
  return { answer };
}

describe('useRequiredDimensionsLeave', () => {
  it('asks after a change when a required dimension has no value; Stay keeps the line and focuses the field', async () => {
    const page = setup({ lineId: 'line-a', axes: [MENU, OPTIONAL], values: {} });
    act(() => page.leave().noteChange('line-a'));
    expect(page.leave().isBusy()).toBe(true);

    const { answer } = ask(page.leave());
    expect(await screen.findByText('opex.editor.requiredLeaveMessage: Menu')).toBeInTheDocument();
    expect(screen.getByText('opex.editor.requiredLeaveTitle')).toBeInTheDocument();
    // Stay is the main action and holds the focus.
    const stay = screen.getByRole('button', { name: 'opex.editor.requiredLeaveStay' });
    await waitFor(() => expect(stay).toHaveFocus());

    fireEvent.click(stay);
    await expect(answer).resolves.toBe(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // The Properties panel opens and the missing field takes the focus.
    expect(screen.getByTestId('drawer-request')).toHaveTextContent('1');
    await waitFor(() => expect(screen.getByLabelText('Menu')).toHaveFocus());
    // Still missing: leaving asks again.
    expect(page.leave().isBusy()).toBe(true);
  });

  it('names every missing dimension, in order, and focuses the first', async () => {
    const page = setup({ lineId: 'line-a', axes: [NATURE, MENU], values: {} });
    act(() => page.leave().noteChange('line-a'));
    const { answer } = ask(page.leave());
    expect(await screen.findByText('opex.editor.requiredLeaveMessage: Menu and Nature')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'opex.editor.requiredLeaveStay' }));
    await expect(answer).resolves.toBe(false);
    await waitFor(() => expect(screen.getByLabelText('Menu')).toHaveFocus());
  });

  it('leaves on « Leave anyway »', async () => {
    const page = setup({ lineId: 'line-a', axes: [MENU], values: {} });
    act(() => page.leave().noteChange('line-a'));
    const { answer } = ask(page.leave());
    fireEvent.click(await screen.findByRole('button', { name: 'opex.editor.requiredLeaveConfirm' }));
    await expect(answer).resolves.toBe(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('drawer-request')).toHaveTextContent('0');
  });

  it('stays when the dialog is closed without an answer', async () => {
    const page = setup({ lineId: 'line-a', axes: [MENU], values: {} });
    act(() => page.leave().noteChange('line-a'));
    const { answer } = ask(page.leave());
    fireEvent.click(await screen.findByRole('button', { name: 'Close dialog' }));
    await expect(answer).resolves.toBe(false);
  });

  it('never asks about a line read without a change', async () => {
    const page = setup({ lineId: 'line-a', axes: [MENU], values: {} });
    expect(page.leave().isBusy()).toBe(false);
    await expect(page.leave().confirm()).resolves.toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('never asks when the value is there (saved or pending)', () => {
    const page = setup({ lineId: 'line-a', axes: [MENU], values: { 'axis-menu': 'value-1' } });
    act(() => page.leave().noteChange('line-a'));
    expect(page.leave().isBusy()).toBe(false);
  });

  it('never asks about a dimension required for CAPEX lines only, a disabled one or an optional one', () => {
    const page = setup({ lineId: 'line-a', axes: [CAPEX_ONLY, DISABLED, OPTIONAL], values: {} });
    act(() => page.leave().noteChange('line-a'));
    expect(page.leave().isBusy()).toBe(false);
  });

  it('never asks a user who cannot edit the line', () => {
    const page = setup({ lineId: 'line-a', canEdit: false, axes: [MENU], values: {} });
    act(() => page.leave().noteChange('line-a'));
    expect(page.leave().isBusy()).toBe(false);
  });

  it('starts a new visit on another line: a change of the previous line no longer counts', () => {
    const page = setup({ lineId: 'line-a', axes: [MENU], values: {} });
    act(() => page.leave().noteChange('line-a'));
    expect(page.leave().isBusy()).toBe(true);
    page.rerender({ lineId: 'line-b', axes: [MENU], values: {} });
    expect(page.leave().isBusy()).toBe(false);
    // Back on line A: a new visit too.
    page.rerender({ lineId: 'line-a', axes: [MENU], values: {} });
    expect(page.leave().isBusy()).toBe(false);
    act(() => page.leave().noteChange('line-a'));
    expect(page.leave().isBusy()).toBe(true);
  });
});

describe('useRequiredDimensionsLeave while asking', () => {
  it('keeps the line on a second move while the question shows', async () => {
    const page = setup({ lineId: 'line-a', axes: [MENU], values: {} });
    act(() => page.leave().noteChange('line-a'));
    const first = ask(page.leave());
    const second = ask(page.leave());
    await expect(second.answer).resolves.toBe(false);
    // One question, answered for the first move.
    expect(await screen.findAllByRole('dialog')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'opex.editor.requiredLeaveConfirm' }));
    await expect(first.answer).resolves.toBe(true);
    // Asked again on the next move.
    const third = ask(page.leave());
    fireEvent.click(await screen.findByRole('button', { name: 'opex.editor.requiredLeaveStay' }));
    await expect(third.answer).resolves.toBe(false);
  });
});
