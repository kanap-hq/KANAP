import { describe, expect, it } from 'vitest';
import { createGrid } from 'ag-grid-community';
import type { ColDef, ColGroupDef, GridApi } from 'ag-grid-community';
import { CSV_EXPORT_GUARD, installCsvExportGuard, neutralizeCsvText } from './csvExportGuard';

// The grids' CSV exports: a tenant-defined name (a budget column label in a
// header or group header, an item name in a cell) that starts like a formula is
// prefixed with a single quote; everything else is written as the grid writes it.

type Row = { name: string; amount: number; note: string };

function grid(columnDefs: Array<ColDef<Row> | ColGroupDef<Row>>, rowData: Row[], withGuard = true): GridApi<Row> {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return createGrid<Row>(element, {
    columnDefs,
    rowData,
    ...(withGuard ? { defaultCsvExportParams: CSV_EXPORT_GUARD } : {}),
  });
}

const money = (value: number) => `${value < 0 ? '-' : ''}${Math.abs(value).toLocaleString('fr-FR')} €`;

describe('neutralizeCsvText', () => {
  it('prefixes formula-like text', () => {
    for (const text of ['=SUM(A1)', '+33 1 23', '-2+3', '@cmd', '\tTab', '\rCR', ' =1+1', '-cmd|calc']) {
      expect(neutralizeCsvText(text)).toBe(`'${text}`);
    }
  });

  it('leaves plain text and negative amounts alone', () => {
    for (const text of ['Budget', 'Réel', '', '-1200.50', '-1 234,50 €', '-12 %', '-1,234.5 EUR', '(1 234)']) {
      expect(neutralizeCsvText(text)).toBe(text);
    }
  });
});

describe('grid CSV export with the guard', () => {
  const rows: Row[] = [
    { name: '=HYPERLINK("http://x")', amount: -1234.5, note: 'Plain' },
    { name: 'Licences', amount: 2000, note: '@risk' },
  ];
  const columns: Array<ColDef<Row> | ColGroupDef<Row>> = [
    { field: 'name', headerName: 'Item' },
    {
      headerName: '=Budget 2027',
      children: [
        { field: 'amount', headerName: '+Revision', valueFormatter: (p) => money(p.value) },
        { field: 'note', headerName: 'Note' },
      ],
    },
  ];

  it('neutralises headers, group headers and cells, and keeps formatted amounts', () => {
    const csv = grid(columns, rows).getDataAsCsv()!;
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('"","\'=Budget 2027",""');
    expect(lines[1]).toBe('"Item","\'+Revision","Note"');
    expect(lines[2]).toBe(`"'=HYPERLINK(""http://x"")","${money(-1234.5)}","Plain"`);
    expect(lines[3]).toBe(`"Licences","${money(2000)}","'@risk"`);
  });

  it('writes the same file as the grid without the guard when nothing looks like a formula', () => {
    const safeRows: Row[] = [{ name: 'Licences', amount: -3, note: 'Plain' }];
    const safeColumns: Array<ColDef<Row> | ColGroupDef<Row>> = [
      { field: 'name', headerName: 'Item' },
      { headerName: 'Budget', children: [{ field: 'amount', headerName: 'Revision', valueFormatter: (p) => money(p.value) }, { field: 'note' }] },
    ];
    expect(grid(safeColumns, safeRows).getDataAsCsv()).toBe(grid(safeColumns, safeRows, false).getDataAsCsv());
  });

  it('applies to every grid once installed, and a call keeps its own params', () => {
    installCsvExportGuard();
    const api = grid([{ field: 'name', headerName: '-Label' }], [rows[0]], false);
    const lines = api.getDataAsCsv({ columnSeparator: ';' })!.split('\r\n');
    expect(lines).toEqual(['"\'-Label"', `"'=HYPERLINK(""http://x"")"`]);
  });
});
