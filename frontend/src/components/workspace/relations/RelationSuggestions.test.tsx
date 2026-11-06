import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import RelationSuggestions, { type RelationSuggestion } from './RelationSuggestions';

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => {
    const args = opts
      ? Object.entries(opts).filter(([name]) => name !== 'defaultValue').map(([name, value]) => `${name}=${value}`).join(',')
      : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'en', resolvedLanguage: 'en' },
};

vi.mock('react-i18next', () => ({
  useTranslation: () => translation,
}));

const SUGGESTION: RelationSuggestion = {
  type: 'technology',
  id: 'tec-1',
  name: 'PostgreSQL',
  via: { kind: 'application_technology', label: 'APP-4' },
};

// 1,280px with the nav and the properties panel open. The relations frame is what remains
// after the 220px nav, the 16px page padding on each side, the 280px panel and the content
// padding (24px + 29px), then a scrollbar.
const FRAME_AT_1280 = 680;
// The frame the relations table already documents at 1,000px with the panel open.
const FRAME_AT_1000 = 405;

let frameWidth = 0;

beforeEach(() => {
  frameWidth = 0;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.tagName === 'DIV' ? frameWidth : 0;
  });
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderSuggestions() {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <MemoryRouter>
        <RelationSuggestions
          suggestions={[SUGGESTION]}
          canEdit
          referenceOf={() => 'TEC-9'}
          href={() => '/it/technologies/TEC-9/overview'}
          onLink={() => {}}
        />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

function viaCell() {
  return screen.getByText('workspace.application.relations.via.application_technology(label=APP-4)').closest('td')!;
}

describe('RelationSuggestions', () => {
  it('wraps Via at 140px on a 1280px record with the properties panel open', () => {
    frameWidth = FRAME_AT_1280;
    renderSuggestions();
    const table = screen.getByRole('table', { name: 'workspace.application.relations.sections.related' });
    const cell = viaCell();

    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'workspace.application.relations.columns.type',
      'workspace.application.relations.columns.object',
      'workspace.application.relations.columns.via',
    ]);
    expect(cell.classList.contains('w')).toBe(true);
    expect(getComputedStyle(cell).whiteSpace).toBe('normal');
    expect(getComputedStyle(cell).textOverflow).toBe('clip');
    expect(getComputedStyle(cell).overflowWrap).toBe('anywhere');
    expect(table.querySelectorAll('col')[2].style.width).toBe('140px');
    // The table stays inside its frame: nothing to scroll sideways.
    expect(table.style.minWidth).toBe('');
    expect(parseInt(table.style.width, 10)).toBeLessThanOrEqual(FRAME_AT_1280);
    expect(getComputedStyle(table.parentElement!).overflowX).toBe('auto');
  });

  it('keeps a wrapping Via, without a horizontal minimum, in the 1000px panel-open frame', () => {
    frameWidth = FRAME_AT_1000;
    renderSuggestions();
    const table = screen.getByRole('table', { name: 'workspace.application.relations.sections.related' });
    const cell = viaCell();

    expect(cell.classList.contains('w')).toBe(true);
    expect(getComputedStyle(cell).whiteSpace).toBe('normal');
    expect(table.style.minWidth).toBe('');
    expect(table.style.width).toBe('');
    const viaWidth = parseInt(table.querySelectorAll('col')[2].style.width, 10);
    expect(viaWidth).toBeGreaterThan(0);
    expect(viaWidth).toBeLessThanOrEqual(140);
  });
});
