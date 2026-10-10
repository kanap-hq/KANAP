import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { MenuItem, Select, TextField } from '@mui/material';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

const stableT = (key: string) => key;
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));

import KanapDialog from './KanapDialog';

function Fields() {
  const [choice, setChoice] = React.useState('a');
  return (
    <>
      <TextField variant="standard" inputProps={{ 'aria-label': 'Code' }} />
      <TextField variant="standard" multiline inputProps={{ 'aria-label': 'Notes' }} />
      <Select
        variant="standard"
        value={choice}
        onChange={(event) => setChoice(String(event.target.value))}
        SelectDisplayProps={{ 'aria-label': 'Choice' } as React.HTMLAttributes<HTMLDivElement>}
      >
        <MenuItem value="a">Alpha</MenuItem>
        <MenuItem value="b">Beta</MenuItem>
      </Select>
    </>
  );
}

function renderDialog(onSave = vi.fn(), onClose = vi.fn()) {
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <KanapDialog open title="Dialog" onClose={onClose} onSave={onSave}>
        <Fields />
      </KanapDialog>
    </ThemeProvider>,
  );
  return { onSave, onClose };
}

describe('KanapDialog Enter key', () => {
  it('submits on Enter in a one-line text input', () => {
    const { onSave } = renderDialog();
    fireEvent.keyDown(screen.getByLabelText('Code'), { key: 'Enter' });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('keeps Enter for a new line in a textarea', () => {
    const { onSave } = renderDialog();
    fireEvent.keyDown(screen.getByLabelText('Notes'), { key: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not submit when a select option is chosen with the keyboard', () => {
    const { onSave } = renderDialog();
    const select = screen.getByRole('combobox', { name: 'Choice' });
    fireEvent.keyDown(select, { key: 'Enter' });
    const listbox = screen.getByRole('listbox');
    fireEvent.keyDown(within(listbox).getByRole('option', { name: 'Beta' }), { key: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: 'Choice' })).toHaveTextContent('Beta');
  });

  it('does not submit on Enter from the cancel button', () => {
    const { onSave } = renderDialog();
    fireEvent.keyDown(screen.getByRole('button', { name: 'buttons.cancel' }), { key: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not submit while the save is disabled', () => {
    const onSave = vi.fn();
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialog open title="Dialog" onClose={vi.fn()} onSave={onSave} saveDisabled>
          <Fields />
        </KanapDialog>
      </ThemeProvider>,
    );
    fireEvent.keyDown(screen.getByLabelText('Code'), { key: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('KanapDialog optional slots', () => {
  it('renders the subtitle and the secondary actions between cancel and the main action', () => {
    const onSecondary = vi.fn();
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialog
          open
          title="Dialog"
          subtitle="A quiet line"
          onClose={vi.fn()}
          onSave={vi.fn()}
          saveLabel="Main"
          secondaryActions={<button type="button" onClick={onSecondary}>Other</button>}
        >
          <div />
        </KanapDialog>
      </ThemeProvider>,
    );
    expect(screen.getByText('A quiet line')).toBeInTheDocument();
    const names = screen.getAllByRole('button').map((button) => button.textContent);
    expect(names.slice(-3)).toEqual(['buttons.cancel', 'Other', 'Main']);
    fireEvent.click(screen.getByRole('button', { name: 'Other' }));
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });
});

describe('KanapDialog footer buttons', () => {
  it('renders Cancel and the main action as pills of one size', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'buttons.cancel' })).toHaveClass('MuiButton-action');
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('MuiButton-action-primary');
  });

  it('renders a destructive main action as the danger pill', () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialog open title="Dialog" onClose={vi.fn()} onSave={vi.fn()} saveLabel="Delete" saveVariant="action-danger">
          <div />
        </KanapDialog>
      </ThemeProvider>,
    );
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('MuiButton-action-danger');
  });
});
