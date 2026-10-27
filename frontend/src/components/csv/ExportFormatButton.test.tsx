import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExportFormatButton from './ExportFormatButton';
import { EXPORT_FORMAT_STORAGE_KEY } from './exportFormat';

const translation = vi.hoisted(() => ({ t: (key: string) => key }));
vi.mock('react-i18next', () => ({ useTranslation: () => translation }));

describe('ExportFormatButton', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens CSV or Excel, sends the choice and remembers it', () => {
    const onExport = vi.fn();
    render(<ExportFormatButton label="Export" onExport={onExport} />);
    const button = screen.getByRole('button', { name: 'Export' });
    expect(onExport).not.toHaveBeenCalled();

    fireEvent.click(button);
    expect(screen.getByRole('menuitem', { name: 'ops:reports.shared.exportCsv' }).classList.contains('Mui-selected')).toBe(true);
    fireEvent.click(screen.getByRole('menuitem', { name: 'ops:reports.shared.exportXlsx' }));
    expect(onExport).toHaveBeenCalledWith('xlsx');
    expect(store[EXPORT_FORMAT_STORAGE_KEY]).toBe('xlsx');

    fireEvent.click(button);
    expect(screen.getByRole('menuitem', { name: 'ops:reports.shared.exportXlsx' }).classList.contains('Mui-selected')).toBe(true);
    fireEvent.click(screen.getByRole('menuitem', { name: 'ops:reports.shared.exportCsv' }));
    expect(onExport).toHaveBeenLastCalledWith('csv');
  });

  it('is disabled while the page says so', () => {
    render(<ExportFormatButton label="Export" onExport={vi.fn()} disabled />);
    expect((screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
