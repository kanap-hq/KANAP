import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { Button, FormControlLabel, MenuItem, Radio, RadioGroup, Select, Switch, TextField } from '@mui/material';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key };
  return { useTranslation: () => translation };
});

import { SettingsPage } from './SettingsPage';
import { SettingField } from './SettingField';

const renderIn = (node: React.ReactNode) => render(<ThemeProvider theme={createAppTheme('light')}>{node}</ThemeProvider>);

describe('SettingsPage', () => {
  it('shows the title alone, then the save state, the pills and History last', () => {
    renderIn(
      <SettingsPage title="Budget columns" status="saving" actions={<Button variant="action">Restore</Button>} history={<Button variant="action">History</Button>}>
        <p>fields</p>
      </SettingsPage>,
    );
    const title = screen.getByRole('heading', { level: 1, name: 'Budget columns' });
    const bar = title.nextElementSibling as HTMLElement;
    expect(within(bar).getByRole('status')).toHaveTextContent('common:status.saving');
    expect(within(bar).getAllByRole('button').map((button) => button.textContent)).toEqual(['Restore', 'History']);
    expect(screen.getByText('fields')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });

  it('draws the module tabs under the title, and nothing in their place without tabs', () => {
    const { rerender } = renderIn(
      <SettingsPage title="IT landscape settings" status="idle" tabs={<nav aria-label="tabs">Lists</nav>}>
        <p>fields</p>
      </SettingsPage>,
    );
    const title = screen.getByRole('heading', { level: 1, name: 'IT landscape settings' });
    const tabs = screen.getByRole('navigation', { name: 'tabs' });
    expect(title.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tabs.compareDocumentPosition(screen.getByText('fields')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(title.closest('div')?.contains(tabs)).toBe(false);
    rerender(<ThemeProvider theme={createAppTheme('light')}><SettingsPage title="Budget columns" status="idle"><p>fields</p></SettingsPage></ThemeProvider>);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 }).parentElement?.nextElementSibling).toHaveTextContent('fields');
  });

  it('says Saved, then nothing at rest', () => {
    const { rerender } = renderIn(<SettingsPage title="T" status="saved" />);
    expect(screen.getByRole('status')).toHaveTextContent('common:status.saved');
    rerender(<ThemeProvider theme={createAppTheme('light')}><SettingsPage title="T" status="idle" /></ThemeProvider>);
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('says Not saved when a save failed', () => {
    renderIn(<SettingsPage title="T" status="error" />);
    expect(screen.getByRole('status')).toHaveTextContent('common:status.notSaved');
  });

  it('gives a reader the same fields read-only, without the pills', () => {
    renderIn(
      <SettingsPage title="T" readOnly actions={<Button variant="action">Restore</Button>} history={<Button variant="action">History</Button>}>
        <SettingField label="Name">
          {({ readOnly }) => <TextField variant="standard" value="A0" InputProps={{ readOnly }} inputProps={{ 'aria-label': 'Name' }} />}
        </SettingField>
      </SettingsPage>,
    );
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'History' })).toBeInTheDocument();
  });

  it('says in one line that the setting could not be loaded, with no field', () => {
    renderIn(<SettingsPage title="T" error="Could not load."><p>fields</p></SettingsPage>);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load.');
    expect(screen.queryByText('fields')).not.toBeInTheDocument();
  });

  it('shows nothing of the page while the setting loads', () => {
    renderIn(<SettingsPage title="T" loading><p>fields</p></SettingsPage>);
    expect(screen.getByText('common:status.loading')).toBeInTheDocument();
    expect(screen.queryByText('fields')).not.toBeInTheDocument();
  });
});

describe('SettingField', () => {
  it('puts the label above the field, the hint beside it and the refusal under it', () => {
    renderIn(
      <SettingField label="Maximum image size (MB)" hint="Where to find it." error="At most 20.">
        {({ error, errorId }) => (
          <TextField variant="standard" value="25" error={error} inputProps={{ 'aria-label': 'size', 'aria-describedby': errorId }} />
        )}
      </SettingField>,
    );
    expect(screen.getByText('Maximum image size (MB)')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Where to find it.' })).toBeInTheDocument();
    const field = screen.getByRole('textbox', { name: 'size' });
    expect(field).toHaveAccessibleDescription('At most 20.');
    expect(field).toHaveAttribute('aria-invalid', 'true');
  });

  it('ties the refusal to a plain control given as is', () => {
    renderIn(
      <SettingField label="Size" error="At most 20.">
        <input aria-label="size" aria-describedby="size-unit" defaultValue="25" />
      </SettingField>,
    );
    const field = screen.getByRole('textbox', { name: 'size' });
    expect(field.getAttribute('aria-describedby')?.split(' ')).toContain('size-unit');
    expect(field).toHaveAccessibleDescription('At most 20.');
    expect(field).toHaveAttribute('aria-invalid', 'true');
  });

  it('ties the refusal to a switch, a radio group and a list, marked invalid only while it shows', () => {
    const fields = (error?: string) => (
      <ThemeProvider theme={createAppTheme('light')}>
        <SettingField label="Web search" error={error}>
          {({ aria }) => <Switch checked inputProps={{ 'aria-label': 'Web search', ...aria }} />}
        </SettingField>
        <SettingField label="Grain" error={error}>
          {({ aria }) => (
            <RadioGroup aria-label="Grain" value="month" {...aria}>
              <FormControlLabel value="month" control={<Radio />} label="Month" />
              <FormControlLabel value="year" control={<Radio />} label="Year" />
            </RadioGroup>
          )}
        </SettingField>
        <SettingField label="Method" error={error}>
          {({ error: invalid, aria }) => (
            <Select variant="standard" value="a" error={invalid} inputProps={{ 'aria-label': 'Method' }} SelectDisplayProps={aria}>
              <MenuItem value="a">A</MenuItem>
            </Select>
          )}
        </SettingField>
      </ThemeProvider>
    );
    const controls = () => [
      screen.getByRole('checkbox', { name: 'Web search' }),
      screen.getByRole('radiogroup', { name: 'Grain' }),
      screen.getByRole('combobox', { name: 'Method' }),
    ];
    const { rerender } = render(fields('Not allowed.'));
    for (const control of controls()) {
      expect(control).toHaveAttribute('aria-invalid', 'true');
      expect(control).toHaveAccessibleDescription('Not allowed.');
    }
    rerender(fields(undefined));
    for (const control of controls()) {
      expect(control).not.toHaveAttribute('aria-invalid');
      expect(control).not.toHaveAccessibleDescription();
    }
  });

  it('is editable outside a read-only page', () => {
    renderIn(
      <SettingField label="Name">
        {({ readOnly }) => <TextField variant="standard" value="" placeholder="e.g., A0" InputProps={{ readOnly }} inputProps={{ 'aria-label': 'Name' }} />}
      </SettingField>,
    );
    expect(screen.getByRole('textbox', { name: 'Name' })).not.toHaveAttribute('readonly');
    expect(screen.getByPlaceholderText('e.g., A0')).toBeInTheDocument();
  });
});
