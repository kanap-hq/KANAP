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
    expect(label).toHaveStyle({ color: theme.palette.error.main });
    expect(screen.getByRole('textbox', { name: 'site' })).toHaveAttribute('aria-invalid', 'true');
    rerender(<ThemeProvider theme={theme}><PropertyRow label="Site" required><input aria-label="site" /></PropertyRow></ThemeProvider>);
    expect(screen.getByText('Site')).not.toHaveAttribute('data-missing');
    expect(screen.getByRole('textbox', { name: 'site' })).not.toHaveAttribute('aria-invalid');
  });
});
