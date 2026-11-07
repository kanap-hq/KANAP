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
