import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { createAppTheme } from '../../config/ThemeContext';

const chartState = { lastOptions: null as any };

vi.mock('ag-charts-react', () => ({
  AgChartsReact: ({ options }: { options: any }) => {
    chartState.lastOptions = options;
    return <div data-testid="report-chart" />;
  },
}));

import ChartCard from './ChartCard';

const pieOptions = { data: [{ name: 'A', value: 1 }], series: [{ type: 'pie', angleKey: 'value' }] };

function renderIn(mode: 'light' | 'dark', options: any = pieOptions) {
  return render(
    <ThemeProvider theme={createAppTheme(mode)}>
      <ChartCard title="Chart" options={options} />
    </ThemeProvider>,
  );
}

describe('ChartCard theme', () => {
  beforeEach(() => {
    chartState.lastOptions = null;
  });

  it('draws report charts with the dark chart theme on a transparent background in dark mode', () => {
    renderIn('dark');
    expect(chartState.lastOptions.theme).toBe('ag-default-dark');
    expect(chartState.lastOptions.background).toEqual({ fill: 'transparent' });
    expect(chartState.lastOptions.series).toEqual(pieOptions.series);
  });

  it('draws them with the light chart theme in light mode', () => {
    renderIn('light');
    expect(chartState.lastOptions.theme).toBe('ag-default');
    expect(chartState.lastOptions.background).toEqual({ fill: 'transparent' });
  });

  it('keeps a theme the page chose itself', () => {
    renderIn('dark', { ...pieOptions, theme: 'ag-default', background: { fill: 'white' } });
    expect(chartState.lastOptions.theme).toBe('ag-default');
    expect(chartState.lastOptions.background).toEqual({ fill: 'white' });
  });
});
