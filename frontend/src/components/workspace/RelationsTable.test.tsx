import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { RelationsTable, fitColumnWidths, type RelationsColumn } from './RelationsTable';

type Row = { id: string; name: string; family: string };

// The columns of an application's technologies (T3): 614px of fixed columns besides the name.
const COLUMNS: Array<RelationsColumn<Row>> = [
  { key: 'ref', header: 'Ref', width: 72, render: (row) => row.id },
  { key: 'name', header: 'Name', render: (row) => row.name },
  { key: 'family', header: 'Family', width: 110, render: (row) => row.family },
  { key: 'version', header: 'Version', width: 72, render: () => '1' },
  { key: 'link', header: 'Link', width: 120, render: () => 'Uses' },
  { key: 'via', header: 'Via', width: 140, render: () => 'SRV-1' },
  { key: 'supportEnd', header: 'Support end', width: 100, render: () => 'Dec 2027' },
];
const ROWS: Row[] = [{ id: 'TEC-1', name: 'PostgreSQL', family: 'Database' }];

let frameWidth = 0;
let resize: (() => void) | null = null;

beforeEach(() => {
  frameWidth = 0;
  resize = null;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.tagName === 'DIV' ? frameWidth : 0;
  });
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() {}
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderTable(props: Partial<React.ComponentProps<typeof RelationsTable<Row>>> = {}) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <MemoryRouter>
        <RelationsTable columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} ariaLabel="Technologies" {...props} />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

const colWidths = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('col')).map((col) => (col.style.width ? parseInt(col.style.width, 10) : undefined));

describe('fitColumnWidths', () => {
  const widths = COLUMNS.map((column) => column.width);

  it('keeps the declared widths when they fit with the name', () => {
    expect(fitColumnWidths(widths, 900)).toEqual({ widths });
  });

  it('shrinks the other columns so that the name keeps 128px', () => {
    const fitted = fitColumnWidths(widths, 520);
    expect(fitted.minWidth).toBeUndefined();
    const fixed = fitted.widths.filter((width): width is number => width != null);
    expect(fixed.reduce((sum, width) => sum + width, 0)).toBeLessThanOrEqual(520 - 128);
    expect(Math.min(...fixed)).toBeGreaterThanOrEqual(64);
    expect(fitted.widths[1]).toBeUndefined();
    // The wider columns give up more room.
    expect(widths[5]! - fitted.widths[5]!).toBeGreaterThan(widths[0]! - fitted.widths[0]!);
  });

  it('never shrinks a column narrower than 64px', () => {
    expect(fitColumnWidths([32, undefined, 200], 300).widths).toEqual([32, undefined, 140]);
  });

  it('asks for a minimum width once the columns are at their least', () => {
    expect(fitColumnWidths(widths, 300)).toEqual({ widths: [64, undefined, 64, 64, 64, 64, 64], minWidth: 6 * 64 + 128 });
  });
});

describe('RelationsTable at narrow width', () => {
  it('keeps the declared widths until the frame is measured', () => {
    const { container } = renderTable();
    expect(colWidths(container)).toEqual(COLUMNS.map((column) => column.width));
  });

  it('fits the columns to the frame and follows its resizes', () => {
    frameWidth = 1200;
    const { container } = renderTable({ onRemove: () => {} });
    expect(colWidths(container)).toEqual([...COLUMNS.map((column) => column.width), 40]);

    frameWidth = 560;
    act(() => resize?.());
    const widths = colWidths(container);
    const fixed = widths.slice(0, -1).filter((width): width is number => width != null);
    expect(fixed.reduce((sum, width) => sum + width, 0)).toBeLessThanOrEqual(560 - 40 - 128);
    expect(widths[1]).toBeUndefined();
    expect(widths[widths.length - 1]).toBe(40);
    expect(screen.getByRole('table').style.minWidth).toBe('');
  });

  it('scrolls inside its frame, never the page, when the columns cannot fit', () => {
    frameWidth = 300;
    renderTable();
    const table = screen.getByRole('table');
    expect(getComputedStyle(table).minWidth).toBe(`${6 * 64 + 128}px`);
    expect(getComputedStyle(table.parentElement!).overflowX).toBe('auto');
  });

  it('shows a cut text whole on hover, and only while it is cut', () => {
    renderTable();
    const cell = screen.getByText('PostgreSQL');
    const scroll = vi.spyOn(cell, 'scrollWidth', 'get').mockReturnValue(200);
    vi.spyOn(cell, 'clientWidth', 'get').mockReturnValue(80);
    fireEvent.mouseOver(cell);
    expect(cell).toHaveAttribute('title', 'PostgreSQL');

    scroll.mockReturnValue(80);
    fireEvent.mouseOver(cell);
    expect(cell).not.toHaveAttribute('title');
  });

  it('leaves the title of a cell content alone', () => {
    renderTable({ columns: [{ key: 'name', header: 'Name', render: (row) => <span title={`${row.name} 16`}>{row.name}</span> }] });
    const cell = screen.getByText('PostgreSQL').closest('td')!;
    vi.spyOn(cell, 'scrollWidth', 'get').mockReturnValue(200);
    fireEvent.mouseOver(screen.getByText('PostgreSQL'));
    expect(cell).not.toHaveAttribute('title');
  });
});
