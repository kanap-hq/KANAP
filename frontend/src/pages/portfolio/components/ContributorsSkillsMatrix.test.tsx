import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import { downloadServerExport } from '../../../components/csv/serverExport';
import portfolioEn from '../../../locales/en/portfolio.json';
import ContributorsSkillsMatrix, { type MatrixContributor } from './ContributorsSkillsMatrix';

vi.mock('../../../components/csv/serverExport', () => ({ downloadServerExport: vi.fn(async () => undefined) }));

// Keys resolve against the real English bundle, so a key the component uses
// but never added to the locale file surfaces here instead of in the browser.
function resolveKey(key: string): string | undefined {
  return key.split('.').reduce<any>((node, part) => (node == null ? undefined : node[part]), portfolioEn);
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const template = resolveKey(key);
      if (typeof template !== 'string') return key;
      return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(opts?.[name] ?? ''));
    },
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));

// This jsdom run starts without a Storage implementation; the component reads
// and writes its view state through it, so give the tests a real one.
if (!window.localStorage) {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => { store.set(key, String(value)); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => { store.clear(); },
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() { return store.size; },
    },
  });
}

const theme = createAppTheme('light');

const TEAMS = [
  { id: 'team-infra', name: 'Infrastructure' },
  { id: 'team-apps', name: 'Applications' },
];

const SKILLS = [
  { id: 's-aws', category: 'Cloud', name: 'AWS', enabled: true },
  { id: 's-azure', category: 'Cloud', name: 'Azure', enabled: true },
  { id: 's-gcp', category: 'Cloud', name: 'GCP', enabled: false },
  { id: 's-bgp', category: 'Network', name: 'BGP', enabled: true },
  { id: 's-wifi', category: 'Network', name: 'Wi-Fi', enabled: true },
];

const CONTRIBUTORS: MatrixContributor[] = [
  {
    id: 'c-1',
    item_number: 1,
    user_display_name: 'Ada Lovelace',
    user_email: 'ada@example.com',
    team_id: 'team-infra',
    skills: [{ skill_id: 's-aws', proficiency: 4 }, { skill_id: 's-bgp', proficiency: 2 }],
  },
  {
    id: 'c-2',
    item_number: 2,
    user_display_name: 'Grace Hopper',
    user_email: 'grace@example.com',
    team_id: 'team-apps',
    skills: [{ skill_id: 's-aws', proficiency: 3 }, { skill_id: 's-azure', proficiency: 1 }],
  },
  {
    id: 'c-3',
    item_number: 3,
    user_display_name: '',
    user_email: 'alan@example.com',
    team_id: null,
    skills: [],
  },
];

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

const exported: { run: ((format: 'csv' | 'xlsx') => Promise<void>) | null } = { run: null };

function renderMatrix(props: Partial<React.ComponentProps<typeof ContributorsSkillsMatrix>> = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={['/portfolio/contributors?view=matrix']}>
        <Routes>
          <Route
            path="/portfolio/contributors"
            element={(
              <ContributorsSkillsMatrix
                contributors={CONTRIBUTORS}
                teams={TEAMS}
                skills={SKILLS}
                filterTeamId="all"
                onActionChange={(action) => { exported.run = action?.onExport ?? null; }}
                {...props}
              />
            )}
          />
          <Route path="*" element={<div />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

/** The two header rows: the group band, then the entry labels. */
function headerRows(): string[][] {
  const thead = screen.getAllByRole('rowgroup')[0];
  return within(thead)
    .getAllByRole('row')
    .map((row) => within(row).getAllByRole('columnheader').map((cell) => cell.textContent ?? ''));
}

const groupBand = () => headerRows()[0];
const columnHeaders = () => headerRows()[1];

/** Level cells plus the trailing summary cell, in column order. */
function cellsOf(name: string): string[] {
  return within(screen.getByRole('row', { name })).getAllByRole('cell').map((cell) => cell.textContent ?? '');
}

function footerCells(): Array<{ text: string; gap: boolean }> {
  const tfoot = screen.getAllByRole('rowgroup')[2];
  return within(tfoot).getAllByRole('cell').map((cell) => ({
    text: cell.textContent ?? '',
    gap: cell.getAttribute('data-thin') === 'true',
  }));
}

/** The group band labels down the left of the body (teams or categories). */
function groupBandsInBody(): string[] {
  const tbody = screen.getAllByRole('rowgroup')[1];
  return within(tbody)
    .getAllByRole('row')
    .filter((row) => within(row).queryAllByRole('rowheader').length === 0)
    .map((row) => row.textContent ?? '');
}

function trailingOf(name: string): { text: string; gap: boolean } {
  const cells = within(screen.getByRole('row', { name })).getAllByRole('cell');
  const last = cells[cells.length - 1];
  return { text: last.textContent ?? '', gap: last.getAttribute('data-thin') === 'true' };
}

function putSkillsInColumns() {
  fireEvent.mouseDown(screen.getByRole('combobox'));
  fireEvent.click(screen.getByRole('option', { name: 'Skills' }));
}

beforeEach(() => {
  window.localStorage.clear();
  exported.run = null;
  vi.mocked(downloadServerExport).mockClear();
});

describe('ContributorsSkillsMatrix', () => {
  it('puts contributors in the columns by default, since catalogues are the longer axis', () => {
    renderMatrix();

    // Column groups are teams, alphabetical, unassigned last.
    expect(groupBand()).toEqual(['', 'Applications', 'Infrastructure', 'Unassigned', '']);
    expect(columnHeaders()).toEqual([
      'Skill', 'Grace Hopper', 'Ada Lovelace', 'alan@example.com', 'Autonomous or expert',
    ]);

    // Rows are the skills, grouped by category. Disabled GCP is dropped, and
    // so is Wi-Fi: nobody has declared it and unused skills start hidden.
    const rowHeaders = screen.getAllByRole('rowheader').map((cell) => cell.textContent);
    expect(rowHeaders).toEqual(['AWS', 'Azure', 'BGP', 'Skills']);
    expect(groupBandsInBody()).toEqual(['Cloud', 'Network']);
  });

  it('prints the level as a digit and leaves undeclared pairs blank', () => {
    renderMatrix();
    expect(cellsOf('AWS')).toEqual(['3', '4', '', '2']);
    expect(cellsOf('Azure')).toEqual(['1', '', '', '0']);
    expect(cellsOf('BGP')).toEqual(['', '2', '', '0']);
  });

  it('counts autonomous or expert people per skill and flags the ones nobody covers', () => {
    renderMatrix();
    expect(trailingOf('AWS')).toEqual({ text: '2', gap: false });
    expect(trailingOf('Azure')).toEqual({ text: '0', gap: true });
    expect(trailingOf('BGP')).toEqual({ text: '0', gap: true });
  });

  it('summarises each contributor along the footer', () => {
    renderMatrix();
    expect(footerCells().map((cell) => cell.text)).toEqual(['1/2', '1/2', '', '']);
    expect(footerCells().some((cell) => cell.gap)).toBe(false);
  });

  it('transposes the whole grid when the columns control switches to skills', () => {
    renderMatrix();
    putSkillsInColumns();

    expect(groupBand()).toEqual(['', 'Cloud', 'Network', '']);
    expect(columnHeaders()).toEqual(['Contributor', 'AWS', 'Azure', 'BGP', 'Skills']);
    expect(cellsOf('Ada Lovelace')).toEqual(['4', '', '2', '1/2']);
    expect(cellsOf('alan@example.com')).toEqual(['', '', '', '']);
    // The two summaries swap sides: coverage moves to the footer, ratios to the right.
    expect(footerCells()).toEqual([
      { text: '2', gap: false },
      { text: '0', gap: true },
      { text: '0', gap: true },
      { text: '', gap: false },
    ]);
    expect(trailingOf('Ada Lovelace')).toEqual({ text: '1/2', gap: false });
  });

  it('remembers the chosen orientation for the next visit', () => {
    const first = renderMatrix();
    putSkillsInColumns();
    expect(columnHeaders()[0]).toBe('Contributor');
    first.unmount();

    renderMatrix();
    expect(columnHeaders()[0]).toBe('Contributor');
  });

  it('opens a contributor from the column header when they are in the columns', () => {
    renderMatrix();
    fireEvent.click(screen.getByRole('button', { name: 'Ada Lovelace' }));
    expect(screen.getByTestId('location').textContent).toBe('/portfolio/contributors/CTR-1/skills');
  });

  it('opens a contributor from the row when they are in the rows', () => {
    renderMatrix();
    putSkillsInColumns();
    fireEvent.click(screen.getByRole('row', { name: 'Grace Hopper' }));
    expect(screen.getByTestId('location').textContent).toBe('/portfolio/contributors/CTR-2/skills');
  });

  it('opens a contributor row from the keyboard', () => {
    renderMatrix();
    putSkillsInColumns();
    fireEvent.keyDown(screen.getByRole('row', { name: 'Ada Lovelace' }), { key: 'Enter' });
    expect(screen.getByTestId('location').textContent).toBe('/portfolio/contributors/CTR-1/skills');
  });

  it('brings the rest of the catalogue back when unused skills are asked for', () => {
    renderMatrix();
    fireEvent.click(screen.getByRole('button', { name: 'Show unused skills' }));
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent))
      .toEqual(['AWS', 'Azure', 'BGP', 'Wi-Fi', 'Skills']);
    expect(trailingOf('Wi-Fi')).toEqual({ text: '0', gap: true });
  });

  it('points at the toggle when every skill was dropped for being unused', () => {
    renderMatrix({ contributors: CONTRIBUTORS.map((row) => ({ ...row, skills: [] })) });
    expect(screen.getByText(/Turn on Show unused skills/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(exported.run).toBeNull();
  });

  it('drops a whole category when its filter pill is switched off', () => {
    renderMatrix();
    fireEvent.click(screen.getByRole('button', { name: 'Cloud' }));
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual(['BGP', 'Skills']);
    // The footer ratios only count the skills still on screen.
    expect(footerCells().map((cell) => cell.text)).toEqual(['', '0/1', '', '']);
  });

  it('restricts columns and recomputes coverage when the page filters on one team', () => {
    renderMatrix({ filterTeamId: 'team-infra' });
    expect(columnHeaders()).toEqual(['Skill', 'Ada Lovelace', 'Autonomous or expert']);
    // Azure goes with Grace: nobody left on screen has declared it.
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual(['AWS', 'BGP', 'Skills']);
    expect(trailingOf('AWS')).toEqual({ text: '1', gap: false });
    expect(trailingOf('BGP')).toEqual({ text: '0', gap: true });
  });

  it('hands the page an export the server builds from the grid as laid out', async () => {
    renderMatrix({ filterTeamId: 'team-apps', filterEmploymentTypeId: 'type-1' });
    await exported.run!('xlsx');

    expect(downloadServerExport).toHaveBeenCalledWith(expect.objectContaining({
      url: '/portfolio/team-members/skills-matrix/export',
      format: 'xlsx',
      language: 'en',
      params: { teamId: 'team-apps', employmentTypeId: 'type-1', orientation: 'contributors', showUnused: 'false', hiddenCategories: undefined },
    }));
  });

  it('sends the orientation and the hidden categories as one JSON list', async () => {
    renderMatrix();
    putSkillsInColumns();
    fireEvent.click(screen.getByRole('button', { name: 'Cloud' }));
    await exported.run!('csv');

    expect(vi.mocked(downloadServerExport).mock.calls[0][0]).toMatchObject({
      format: 'csv',
      params: { teamId: 'all', employmentTypeId: 'all', orientation: 'skills', showUnused: 'false', hiddenCategories: '["Cloud"]' },
    });
  });

  it('says so when the export fails', async () => {
    vi.mocked(downloadServerExport).mockRejectedValueOnce(new Error('boom'));
    renderMatrix();
    await act(async () => { await exported.run!('xlsx'); });
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('says so when the team filter leaves no contributor', () => {
    renderMatrix({ contributors: [], filterTeamId: 'team-infra' });
    expect(screen.getByText('No contributor in this team.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    // Nothing on screen, so the page is told there is nothing to export.
    expect(exported.run).toBeNull();
  });

  it('says so when every category is switched off', () => {
    renderMatrix();
    fireEvent.click(screen.getByRole('button', { name: 'Cloud' }));
    fireEvent.click(screen.getByRole('button', { name: 'Network' }));
    expect(screen.getByText('Every skill is hidden by the filters above.')).toBeInTheDocument();
  });
});
