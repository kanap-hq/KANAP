import React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import { NumberField } from './ContractFields';

/**
 * The amount is right-aligned, so a click on the field lands before the digits.
 * `offset: 0` is that click: without a selection on entry, typing 12000 over 0 yields 120000.
 */
async function clickAtStart(user: ReturnType<typeof userEvent.setup>, input: HTMLInputElement) {
  await user.pointer({ target: input, offset: 0, keys: '[MouseLeft]' });
}

function renderNumber(kind: 'amount' | 'months', initial: number | null) {
  const onCommit = vi.fn();
  const seen: number[] = [];
  const label = kind === 'amount' ? 'Yearly amount' : 'Duration';
  function Harness() {
    const [value, setValue] = React.useState<number | null>(initial);
    return (
      <NumberField
        kind={kind}
        value={value}
        onValue={(next) => { seen.push(next); setValue(next); }}
        onCommit={onCommit}
        ariaLabel={label}
      />
    );
  }
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <Harness />
    </ThemeProvider>,
  );
  return {
    onCommit,
    seen,
    input: () => screen.getByRole('textbox', { name: label }) as HTMLInputElement,
  };
}

describe('NumberField selects its content on entry', () => {
  it('replaces a yearly amount of 0 when 12000 is typed where a click lands', async () => {
    const user = userEvent.setup();
    const { seen, onCommit, input } = renderNumber('amount', 0);
    const field = input();
    expect(field.value).toBe('0');
    await clickAtStart(user, field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
    await user.type(field, '12000', { skipClick: true });
    expect(field.value).toBe('12000');
    expect(seen[seen.length - 1]).toBe(12000);
    await user.tab();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('replaces a month count of 0 the same way', async () => {
    const user = userEvent.setup();
    const { seen, input } = renderNumber('months', 0);
    const field = input();
    expect(field.value).toBe('0');
    await clickAtStart(user, field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
    await user.type(field, '24', { skipClick: true });
    expect(field.value).toBe('24');
    expect(seen[seen.length - 1]).toBe(24);
  });

  it('selects the whole amount when the field is reached from the keyboard', async () => {
    const user = userEvent.setup();
    const { seen, input } = renderNumber('amount', 0);
    const field = input();
    // Tab in the test runner selects by itself. A plain focus is what the field has to do,
    // the same way a date field selects on entry.
    act(() => { field.focus(); });
    expect(field).toHaveFocus();
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
    act(() => { field.blur(); });
    await user.tab();
    expect(field).toHaveFocus();
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
    await user.keyboard('12000');
    expect(field.value).toBe('12000');
    expect(seen[seen.length - 1]).toBe(12000);
  });

  it('leaves the caret where a later click lands, so one digit can be edited', async () => {
    const user = userEvent.setup();
    const { input } = renderNumber('months', 12);
    const field = input();
    await clickAtStart(user, field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(2);
    await user.pointer({ target: field, offset: 2, keys: '[MouseLeft]' });
    expect(field.selectionStart).toBe(2);
    expect(field.selectionEnd).toBe(2);
    await user.keyboard('3');
    expect(field.value).toBe('123');
  });
});
