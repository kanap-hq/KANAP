import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import {
  GROW_MAX, NAME_MAX, NAME_MIN_WIDE, RelationsSection, RelationsTable,
  actionColumnWidth, fitColumnWidths, fitColumns, sizeRelationColumns, type RelationsColumn,
} from './RelationsTable';

type Row = { id: string; name: string; family: string };

// The columns of an application's technologies (T3): 614px of fixed columns besides the name.
const COLUMNS: Array<RelationsColumn<Row>> = [
  { key: 'ref', header: 'Ref', width: 72, render: (row) => row.id },
  { key: 'name', header: 'Name', render: (row) => row.name },
  { key: 'family', header: 'Family', width: 110, hideOrder: 3, render: (row) => row.family },
  { key: 'version', header: 'Version', width: 72, render: () => '1' },
  { key: 'link', header: 'Link', width: 120, hideOrder: 2, render: () => 'Uses' },
  { key: 'via', header: 'Via', width: 140, hideOrder: 1, render: () => 'SRV-1' },
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
    expect(fitColumnWidths(COLUMNS, 900)).toEqual({ widths });
  });

  it('shrinks the other columns so that the name keeps 120px', () => {
    const fitted = fitColumnWidths(COLUMNS, 700);
    expect(fitted.minWidth).toBeUndefined();
    const fixed = fitted.widths.filter((width): width is number => width != null);
    expect(fixed.reduce((sum, width) => sum + width, 0)).toBeLessThanOrEqual(700 - 120);
    expect(fitted.widths[1]).toBeUndefined();
    // The wider columns give up more room; the reference, at 72px, keeps its width.
    expect(widths[5]! - fitted.widths[5]!).toBeGreaterThan(widths[2]! - fitted.widths[2]!);
    expect(fitted.widths[0]).toBe(72);
  });

  it('never shrinks a column below 96px, nor one narrower than that', () => {
    expect(fitColumnWidths([{ width: 32 }, {}, { width: 200 }], 300).widths).toEqual([32, undefined, 148]);
    expect(fitColumnWidths([{}, { width: 140 }, { width: 130 }], 280)).toEqual({ widths: [undefined, 96, 96], minWidth: 96 + 96 + 120 });
  });

  it('shrinks a column with its own minWidth no further than it, above or below 96px', () => {
    expect(fitColumnWidths([{}, { width: 120, minWidth: 120 }, { width: 150, minWidth: 80 }], 360).widths).toEqual([undefined, 120, 120]);
    expect(fitColumnWidths([{}, { width: 120, minWidth: 120 }, { width: 150, minWidth: 80 }], 300)).toEqual({ widths: [undefined, 120, 80], minWidth: 200 + 120 });
  });

  it('asks for a minimum width once the columns are at their least', () => {
    expect(fitColumnWidths(COLUMNS, 300)).toEqual({ widths: [72, undefined, 96, 72, 96, 96, 96], minWidth: 528 + 120 });
  });
});

describe('fitColumns', () => {
  const keys = (available: number) => fitColumns(COLUMNS, available).columns.map((column) => column.key);
  const all = COLUMNS.map((column) => column.key);

  it('shows every column while they lose at most a fifth of their width and keep 96px', () => {
    expect(keys(765)).toEqual(all);
    expect(keys(120 + 528)).toEqual(all);
    expect(keys(120 + 527)).toEqual(['ref', 'name', 'family', 'version', 'link', 'supportEnd']);
  });

  it('hides the columns by their order, then fits the others', () => {
    expect(keys(600)).toEqual(['ref', 'name', 'family', 'version', 'link', 'supportEnd']);
    // 1,000px with the properties panel open: a 405px frame, 40px of it for the unlink icon.
    const fitted = fitColumns(COLUMNS, 365);
    expect(fitted.columns.map((column) => column.key)).toEqual(['ref', 'name', 'version', 'supportEnd']);
    expect(fitted.minWidth).toBeUndefined();
    expect(fitted.widths.reduce<number>((sum, width) => sum + (width ?? 0), 0)).toBeLessThanOrEqual(365 - 120);
  });

  it('never hides a column without an order', () => {
    expect(keys(100)).toEqual(['ref', 'name', 'version', 'supportEnd']);
    expect(fitColumns(COLUMNS, 100).minWidth).toBe(72 + 72 + 96 + 120);
  });
});

describe('sizeRelationColumns', () => {
  // Name content below its wide minimum, one column that grows to its text, one capped at
  // GROW_MAX, and a wrapping column that must stay put.
  const columns: Array<Pick<RelationsColumn<unknown>, 'width' | 'wrap'>> = [
    {},
    { width: 200 },
    { width: 80 },
    { width: 140, wrap: true },
  ];
  const content = [10, 300, 1000, 500];
  const targets = [NAME_MIN_WIDE, 300, GROW_MAX, 140];
  const natural = targets.reduce((sum, width) => sum + width, 0);
  const base = [120, 200, 80, 140].reduce((sum, width) => sum + width, 0);
  const sum = (widths: Array<number | undefined>) => widths.reduce<number>((total, width) => total + (width ?? 0), 0);

  it('gives the name its content on a wide frame, bounded below and above', () => {
    expect(sizeRelationColumns(columns, content, natural + 80)).toEqual({ columns, widths: targets, tableWidth: natural });
    expect(sizeRelationColumns([{}], [NAME_MAX + 250], 1000)).toEqual({
      columns: [{}], widths: [NAME_MAX], tableWidth: NAME_MAX,
    });
    expect(targets[0]).toBe(NAME_MIN_WIDE);
  });

  it('grows a column up to its content and no further than GROW_MAX, and never past a wider declaration', () => {
    expect(sizeRelationColumns([{ width: 200 }], [300], 1000).widths).toEqual([300]);
    expect(sizeRelationColumns([{ width: 200 }], [500], 1000).widths).toEqual([GROW_MAX]);
    expect(sizeRelationColumns([{ width: 400 }], [500], 1000).widths).toEqual([400]);
    expect(sizeRelationColumns([{ width: 400 }], [350], 1000).widths).toEqual([400]);
  });

  it('keeps a wrapping column at its declared width', () => {
    expect(sizeRelationColumns([{ width: 140, wrap: true }], [500], 1000)).toEqual({
      columns: [{ width: 140, wrap: true }], widths: [140], tableWidth: 140,
    });
  });

  it('is continuous at both edges of the middle regime', () => {
    const atNatural = sizeRelationColumns(columns, content, natural);
    const justUnder = sizeRelationColumns(columns, content, natural - 1);
    expect(atNatural).toEqual({ columns, widths: targets, tableWidth: natural });
    expect(justUnder.tableWidth).toBeUndefined();
    expect(sum(justUnder.widths)).toBe(natural - 1);
    justUnder.widths.forEach((width, index) => {
      expect(targets[index] - width!).toBeGreaterThanOrEqual(0);
      expect(targets[index] - width!).toBeLessThanOrEqual(1);
    });

    expect(sizeRelationColumns(columns, content, base).widths).toEqual([120, 200, 80, 140]);
    let previous = sizeRelationColumns(columns, content, base).widths as number[];
    for (let available = base + 1; available < natural; available += 1) {
      const widths = sizeRelationColumns(columns, content, available).widths as number[];
      expect(sum(widths)).toBe(available);
      widths.forEach((width, index) => {
        expect(width).toBeGreaterThanOrEqual(previous[index]);
        expect(width - previous[index]).toBeLessThanOrEqual(1);
      });
      previous = widths;
    }

    // One pixel under the base is the narrow fit, the same one the table uses today.
    expect(sizeRelationColumns(columns, content, base - 1)).toEqual(fitColumns(columns, base - 1));
  });

  it('matches fitColumns below the base, including a column hidden by its order', () => {
    const wide = COLUMNS.map(() => 400);
    expect(sizeRelationColumns(COLUMNS, wide, 300)).toEqual(fitColumns(COLUMNS, 300));
    expect(sizeRelationColumns(COLUMNS, wide, 365)).toEqual(fitColumns(COLUMNS, 365));
    expect(sizeRelationColumns(COLUMNS, COLUMNS.map(() => 0), 100)).toEqual(fitColumns(COLUMNS, 100));
    // The base of a table that already hid columns is the columns still passed in.
    const shown = COLUMNS.filter((column) => column.key !== 'via' && column.key !== 'link' && column.key !== 'family');
    const shownBase = 72 + 72 + 100 + 120;
    expect(sizeRelationColumns(shown, shown.map(() => 0), shownBase).widths).toEqual([72, 120, 72, 100]);
    expect(sizeRelationColumns(shown, shown.map(() => 0), shownBase - 1)).toEqual(fitColumns(shown, shownBase - 1));
  });
});

describe('actionColumnWidth', () => {
  const dataBase = 734;

  it('grows to the measured label, with no cap, and never under the declaration', () => {
    // « Verknüpfen » measures 75px against a 56px declaration.
    expect(actionColumnWidth(56, 75, dataBase, dataBase + 75)).toBe(75);
    expect(actionColumnWidth(56, 75, dataBase, 2000)).toBe(75);
    // A short label has no GROW_MAX: the column takes its content.
    expect(actionColumnWidth(56, 500, dataBase, dataBase + 500)).toBe(500);
    expect(actionColumnWidth(56, 40, dataBase, 2000)).toBe(56);
    expect(actionColumnWidth(56, 0, dataBase, 2000)).toBe(56);
  });

  it('keeps the declaration when the grown width does not fit the base', () => {
    expect(actionColumnWidth(56, 75, dataBase, dataBase + 75 - 1)).toBe(56);
    expect(actionColumnWidth(56, 75, dataBase, 405)).toBe(56);
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
    // Nothing is measured here, so the name takes its wide minimum and the table stops at that.
    const declared = COLUMNS.reduce((sum, column) => sum + (column.width ?? 0), 0);
    expect(colWidths(container)).toEqual([72, NAME_MIN_WIDE, 110, 72, 120, 140, 100, 40]);
    expect(screen.getByRole('table').style.width).toBe(`${declared + NAME_MIN_WIDE + 40}px`);

    frameWidth = 405;
    act(() => resize?.());
    expect(screen.getByRole('table').style.width).toBe('');
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Ref', 'Name', 'Version', 'Support end']);
    expect(screen.queryByText('SRV-1')).toBeNull();
    const widths = colWidths(container);
    expect(widths).toHaveLength(5);
    const fixed = widths.slice(0, -1).filter((width): width is number => width != null);
    expect(fixed.reduce((sum, width) => sum + width, 0)).toBeLessThanOrEqual(405 - 40 - 120);
    expect(widths[1]).toBeUndefined();
    expect(widths[widths.length - 1]).toBe(40);
    expect(screen.getByRole('table').style.minWidth).toBe('');
  });

  it('scrolls inside its frame, never the page, when the columns cannot fit', () => {
    frameWidth = 300;
    renderTable({ columns: COLUMNS.map(({ hideOrder: _hideOrder, ...column }) => column) });
    const table = screen.getByRole('table');
    expect(getComputedStyle(table).minWidth).toBe(`${528 + 120}px`);
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

describe('RelationsTable action column', () => {
  const fixed = COLUMNS.reduce((sum, column) => sum + (column.width ?? 0), 0);
  const action = { width: 56, render: () => <button type="button">Verknüpfen</button> };

  function mockActionMeasure(width: number) {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const value = this.tagName === 'TH' && this.hasAttribute('aria-hidden') ? width : 0;
      return { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: value, width: value, height: 0, toJSON() { return {}; } } as DOMRect;
    });
  }

  it('grows to the measured label on a wide frame and keeps that width in the natural width', () => {
    mockActionMeasure(75);
    frameWidth = 1600;
    const { container } = renderTable({ action });
    expect(colWidths(container).at(-1)).toBe(75);
    expect(screen.getByRole('table').style.width).toBe(`${fixed + NAME_MIN_WIDE + 75}px`);
  });

  it('keeps the declared width when the measured label does not fit', () => {
    mockActionMeasure(75);
    frameWidth = 405;
    const { container } = renderTable({ action });
    expect(colWidths(container).at(-1)).toBe(56);
    expect(screen.getByRole('table').style.width).toBe('');
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Ref', 'Name', 'Version', 'Support end']);
  });
});

describe('RelationsTable on a wide frame', () => {
  const fixed = COLUMNS.reduce((sum, column) => sum + (column.width ?? 0), 0);

  it('takes its natural width and the section caps itself there', () => {
    frameWidth = 1600;
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <RelationsSection title="Technologies" onAdd={() => {}} addLabel="Add">
            <RelationsTable columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} onRemove={() => {}} ariaLabel="Technologies" />
          </RelationsSection>
        </MemoryRouter>
      </ThemeProvider>,
    );
    const natural = fixed + NAME_MIN_WIDE + 40;
    const table = screen.getByRole('table', { name: 'Technologies' });
    expect(table.style.width).toBe(`${natural}px`);
    expect(colWidths(table)).toEqual([72, NAME_MIN_WIDE, 110, 72, 120, 140, 100, 40]);
    expect(getComputedStyle(screen.getByRole('region', { name: 'Technologies' })).maxWidth).toBe(`${natural}px`);
  });

  it('caps the section at the widest of its tables', () => {
    frameWidth = 1600;
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <RelationsSection title="Relations">
            <RelationsTable columns={COLUMNS.slice(0, 2)} rows={ROWS} rowKey={(row) => row.id} ariaLabel="Short" />
            <RelationsTable columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} onRemove={() => {}} ariaLabel="Technologies" />
          </RelationsSection>
        </MemoryRouter>
      </ThemeProvider>,
    );
    const short = 72 + NAME_MIN_WIDE;
    const wide = fixed + NAME_MIN_WIDE + 40;
    expect(screen.getByRole('table', { name: 'Short' }).style.width).toBe(`${short}px`);
    expect(screen.getByRole('table', { name: 'Technologies' }).style.width).toBe(`${wide}px`);
    expect(getComputedStyle(screen.getByRole('region', { name: 'Relations' })).maxWidth).toBe(`${wide}px`);
  });
});

describe('RelationsTable rows as links', () => {
  it('makes the name cell a real link to the row page, and the row no longer a tab stop', () => {
    render(
      <MemoryRouter>
        <ThemeProvider theme={createAppTheme('light')}>
          <RelationsTable columns={COLUMNS.slice(0, 2)} rows={ROWS} rowKey={(row) => row.id} rowHref={(row) => `/it/technologies/${row.id}`} linkRows />
        </ThemeProvider>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'PostgreSQL' });
    expect(link.getAttribute('href')).toBe('/it/technologies/TEC-1');
    expect(link.closest('tr')).not.toHaveAttribute('tabindex');
  });

  it('keeps a plain row that opens on click and Enter when the table does not ask for links', () => {
    render(
      <MemoryRouter>
        <ThemeProvider theme={createAppTheme('light')}>
          <RelationsTable columns={COLUMNS.slice(0, 2)} rows={ROWS} rowKey={(row) => row.id} rowHref={(row) => `/it/technologies/${row.id}`} />
        </ThemeProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('PostgreSQL').closest('tr')).toHaveAttribute('tabindex', '0');
  });
});
