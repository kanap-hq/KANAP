import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { PropertyRow } from './PropertyRow';

const renderRow = (node: React.ReactElement) => render(<ThemeProvider theme={createAppTheme('light')}>{node}</ThemeProvider>);

describe('PropertyRow hint', () => {
  it('puts the hint in a tooltip beside the label, with no line under the field', async () => {
    renderRow(<PropertyRow label="Reporting currency" hint="Used for reports and totals." required><input aria-label="value" /></PropertyRow>);
    const icon = screen.getByLabelText('Used for reports and totals.');
    expect(icon.parentElement).toHaveTextContent('Reporting currency*');
    expect(screen.queryByText('Used for reports and totals.')).toBeNull();
    fireEvent.mouseOver(icon);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Used for reports and totals.');
  });

  it('shows no icon without a hint', () => {
    renderRow(<PropertyRow label="Allowed currencies"><input aria-label="value" /></PropertyRow>);
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('PropertyRow missing', () => {
  it('turns the label red and marks the field invalid while missing, and puts it back after', () => {
    const theme = createAppTheme('light');
    const { rerender } = renderRow(<PropertyRow label="Site" required missing><input aria-label="site" /></PropertyRow>);
    const label = screen.getByText('Site');
    expect(label).toHaveAttribute('data-missing');
    expect(label).toHaveStyle({ color: theme.palette.kanap.danger });
    expect(screen.getByRole('textbox', { name: 'site' })).toHaveAttribute('aria-invalid', 'true');
    rerender(<ThemeProvider theme={theme}><PropertyRow label="Site" required><input aria-label="site" /></PropertyRow></ThemeProvider>);
    expect(screen.getByText('Site')).not.toHaveAttribute('data-missing');
    expect(screen.getByRole('textbox', { name: 'site' })).not.toHaveAttribute('aria-invalid');
  });
});

describe('PropertyRow missing signal beyond the colour', () => {
  it('draws an icon with a name and a tooltip after the label and its asterisk, and says why the field is invalid', async () => {
    renderRow(<PropertyRow label="Account" required missing><input aria-label="account" /></PropertyRow>);
    const icon = screen.getByRole('img', { name: 'common:creation.missingMark' });
    const label = screen.getByText('Account');
    expect(label).toContainElement(icon);
    expect(label.textContent).toBe('Account*');
    expect(label.lastElementChild).toBe(icon);
    fireEvent.mouseOver(icon);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('common:creation.missingMark');
    const input = screen.getByRole('textbox', { name: 'account' });
    const described = input.getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    expect(document.getElementById(described as string)).toHaveTextContent('common:creation.missingMark');
  });

  it('keeps the description a control already has, and gives everything back once the field is not missing', () => {
    const theme = createAppTheme('light');
    const row = (missing: boolean) => (
      <ThemeProvider theme={theme}>
        <PropertyRow label="Account" required missing={missing}>
          <input aria-label="account" aria-describedby="own-help" />
        </PropertyRow>
      </ThemeProvider>
    );
    const { rerender } = render(<>{row(true)}<p id="own-help">Own help</p></>);
    const tokens = screen.getByRole('textbox', { name: 'account' }).getAttribute('aria-describedby')?.split(' ');
    expect(tokens).toContain('own-help');
    expect(tokens).toHaveLength(2);
    rerender(<>{row(true)}<p id="own-help">Own help</p></>);
    expect(screen.getByRole('textbox', { name: 'account' }).getAttribute('aria-describedby')?.split(' ')).toHaveLength(2);
    rerender(<>{row(false)}<p id="own-help">Own help</p></>);
    const input = screen.getByRole('textbox', { name: 'account' });
    expect(input.getAttribute('aria-describedby')).toBe('own-help');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('img', { name: 'common:creation.missingMark' })).toBeNull();
  });

  it('leaves no aria-describedby on a control that had none, once the field is not missing', () => {
    const theme = createAppTheme('light');
    const { rerender } = renderRow(<PropertyRow label="Site" missing><input aria-label="site" /></PropertyRow>);
    expect(screen.getByRole('textbox', { name: 'site' })).toHaveAttribute('aria-describedby');
    rerender(<ThemeProvider theme={theme}><PropertyRow label="Site"><input aria-label="site" /></PropertyRow></ThemeProvider>);
    expect(screen.getByRole('textbox', { name: 'site' })).not.toHaveAttribute('aria-describedby');
  });
});
