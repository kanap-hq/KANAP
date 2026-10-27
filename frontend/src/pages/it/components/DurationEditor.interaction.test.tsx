import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import i18n from '../../../i18n';
import DurationEditor from './DurationEditor';

const theme = createAppTheme('light');

function renderEditor(props: Partial<React.ComponentProps<typeof DurationEditor>> = {}) {
  const onCommit = props.onCommit ?? vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <DurationEditor
        value={null}
        onCommit={onCommit}
        ariaLabel="Recovery duration"
        {...props}
      />
    </ThemeProvider>,
  );
  return { onCommit };
}

function chooseUnit(name: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Recovery duration unit' }));
  fireEvent.click(screen.getByRole('option', { name }));
}

describe('DurationEditor interactions', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('changes display units without changing or committing the stored minutes', () => {
    const onCommit = vi.fn();
    renderEditor({ value: 1440, onCommit });

    expect(screen.getByRole('textbox', { name: 'Recovery duration' })).toHaveValue('1');
    expect(screen.getByRole('combobox', { name: 'Recovery duration unit' })).toHaveTextContent('day');

    chooseUnit('hours');

    expect(screen.getByRole('textbox', { name: 'Recovery duration' })).toHaveValue('24');
    fireEvent.blur(screen.getByRole('textbox', { name: 'Recovery duration' }));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits a free duration as exact integer minutes', () => {
    const { onCommit } = renderEditor();
    const input = screen.getByRole('textbox', { name: 'Recovery duration' });

    fireEvent.change(input, { target: { value: '1.5' } });
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith(90);
  });

  it('commits an empty duration as null', () => {
    const { onCommit } = renderEditor({ value: 60 });
    const input = screen.getByRole('textbox', { name: 'Recovery duration' });

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it('rejects values that cannot be represented as whole minutes', () => {
    const { onCommit } = renderEditor();
    const input = screen.getByRole('textbox', { name: 'Recovery duration' });

    fireEvent.change(input, { target: { value: '0.01' } });
    fireEvent.blur(input);

    expect(screen.getByRole('alert')).toHaveTextContent('This duration does not make a whole number of minutes.');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('names the chosen unit in the message and accepts decimals that make whole minutes', () => {
    const { onCommit } = renderEditor();
    const input = screen.getByRole('textbox', { name: 'Recovery duration' });

    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a number of hours greater than 0.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('whole');

    fireEvent.change(input, { target: { value: '1.5' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(90);
  });

  it('writes the unit in the singular for the value 1', () => {
    renderEditor({ value: 60 });
    expect(screen.getByRole('combobox', { name: 'Recovery duration unit' })).toHaveTextContent('hour');
    expect(screen.getByRole('combobox', { name: 'Recovery duration unit' })).not.toHaveTextContent('hours');
    fireEvent.change(screen.getByRole('textbox', { name: 'Recovery duration' }), { target: { value: '2' } });
    expect(screen.getByRole('combobox', { name: 'Recovery duration unit' })).toHaveTextContent('hours');
  });

  it('reports changed and invalid drafts as blocking until the stored value catches up', () => {
    const onDraftStateChange = vi.fn();
    const { rerender } = render(
      <ThemeProvider theme={theme}>
        <DurationEditor value={60} onCommit={vi.fn()} onDraftStateChange={onDraftStateChange} ariaLabel="Recovery duration" />
      </ThemeProvider>,
    );
    const input = screen.getByRole('textbox', { name: 'Recovery duration' });

    fireEvent.change(input, { target: { value: '0.01' } });
    expect(onDraftStateChange).toHaveBeenLastCalledWith(true);
    fireEvent.change(input, { target: { value: '2' } });
    expect(onDraftStateChange).toHaveBeenLastCalledWith(true);

    rerender(
      <ThemeProvider theme={theme}>
        <DurationEditor value={120} onCommit={vi.fn()} onDraftStateChange={onDraftStateChange} ariaLabel="Recovery duration" />
      </ThemeProvider>,
    );
    expect(onDraftStateChange).toHaveBeenLastCalledWith(false);
  });

  it('preserves zero as an explicit RPO value', () => {
    const { onCommit } = renderEditor({ allowZero: true });
    const input = screen.getByRole('textbox', { name: 'Recovery duration' });

    chooseUnit('minutes');
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledWith(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('accepts 1,5 in French and commits 1.5 hours as 90 minutes', async () => {
    await i18n.changeLanguage('fr');
    const { onCommit } = renderEditor();
    const input = screen.getByRole('textbox', { name: 'Recovery duration' });

    fireEvent.change(input, { target: { value: '1,5' } });

    expect(input).toHaveValue('1,5');
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith(90);
  });
});
