import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import portfolioEn from '../../../locales/en/portfolio.json';
import type { OrgContributor } from '../orgChart';
import { exportOrgChartAsPng } from './contributors-org-png';
import ContributorsOrgChart from './ContributorsOrgChart';

// Keys resolve against the real English bundle, so a key the component uses but
// never added to the locale file surfaces here instead of in the browser.
function resolveKey(key: string, opts?: Record<string, unknown>): string | undefined {
  const read = (candidate: string) => candidate
    .split('.')
    .reduce<any>((node, part) => (node == null ? undefined : node[part]), portfolioEn);
  if (opts && typeof opts.count === 'number') {
    const plural = read(`${key}_${opts.count === 1 ? 'one' : 'other'}`);
    if (typeof plural === 'string') return plural;
  }
  return read(key);
}

// `t` must keep a stable identity across renders, as i18next's does: the chart
// memoizes the action it hands up on `t`.
const translate = (key: string, opts?: Record<string, unknown>) => {
  const template = resolveKey(key, opts);
  if (typeof template !== 'string') return key;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(opts?.[name] ?? ''));
};
const translation = { t: translate, i18n: { language: 'en', resolvedLanguage: 'en' } };

vi.mock('react-i18next', () => ({ useTranslation: () => translation }));

vi.mock('./contributors-org-png', () => ({ exportOrgChartAsPng: vi.fn(async () => undefined) }));

vi.mock('../../../components/design', () => ({ useKanapDialogs: () => ({ alert: vi.fn(async () => undefined) }) }));

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

const INTERNAL = 'type-internal';
const EXTERNAL = 'type-external';

const EMPLOYMENT_TYPES = [
  { id: INTERNAL, name: 'Internal', is_active: true },
  { id: EXTERNAL, name: 'External', is_active: true },
];

function person(index: number, name: string, overrides: Partial<OrgContributor> = {}): OrgContributor {
  return {
    id: `c-${index}`,
    item_number: index,
    user_id: `u-${index}`,
    user_display_name: name,
    user_email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
    user_status: 'enabled',
    employment_type_id: INTERNAL,
    employment_type_name: 'Internal',
    manager_user_id: null,
    skills: [],
    ...overrides,
  };
}

const TEAM: OrgContributor[] = [
  person(1, 'Ada Lovelace', {
    manager_user_id: 'u-director',
    job_title: 'Head of IT',
    skills: [{ skill_id: 's-aws', proficiency: 4 }, { skill_id: 's-bgp', proficiency: 2 }],
  }),
  person(2, 'Ben Carter', { manager_user_id: 'u-1' }),
  person(3, 'Cleo Marsh', {
    manager_user_id: 'u-1',
    employment_type_id: EXTERNAL,
    employment_type_name: 'External',
  }),
  person(4, 'Dan Reed', { manager_user_id: 'u-3' }),
  person(5, 'Eve Nunes', { manager_user_id: 'u-1', user_status: 'disabled' }),
];

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

const action: { label: string | null; run: (() => void) | null } = { label: null, run: null };

function renderChart(path = '/portfolio/contributors?view=org', contributors = TEAM) {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/portfolio/contributors"
            element={(
              <ContributorsOrgChart
                contributors={contributors}
                employmentTypes={EMPLOYMENT_TYPES}
                onActionChange={(next) => { action.label = next?.label ?? null; action.run = next?.run ?? null; }}
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

/** Every card on the canvas, in layout order. */
const cardNames = () => within(screen.getByRole('group', { name: 'Reporting line' }))
  .getAllByRole('button')
  .map((node) => node.getAttribute('aria-label') ?? '')
  .filter((label) => !label.startsWith('Hide ') && !label.startsWith('Show '));

const card = (name: string) => screen.getByRole('button', { name });
const search = () => screen.getByTestId('location').textContent ?? '';

beforeEach(() => {
  window.localStorage.clear();
  action.label = null;
  action.run = null;
  vi.mocked(exportOrgChartAsPng).mockClear();
});

describe('ContributorsOrgChart', () => {
  it('draws one card per contributor and one connector per reporting link', () => {
    renderChart();

    // Eve is disabled, so she is out; her absence does not cost anyone a card.
    expect(cardNames().sort()).toEqual(['Ada Lovelace', 'Ben Carter', 'Cleo Marsh', 'Dan Reed']);
    expect(screen.getByTestId('org-connectors').querySelectorAll('path')).toHaveLength(3);

    const ada = card('Ada Lovelace');
    expect(within(ada).getByText('Head of IT')).toBeInTheDocument();
    expect(within(ada).getByText('Internal')).toBeInTheDocument();
    expect(within(ada).getByLabelText('2 skills')).toHaveTextContent('2');
    // Names only: an e-mail never shows up as a subtitle.
    expect(screen.queryByText('ada.lovelace@example.com')).toBeNull();
  });

  it('opens the contributor by their reference when a card is clicked', () => {
    renderChart();
    fireEvent.click(card('Ben Carter'));
    expect(search()).toBe('/portfolio/contributors/MEM-2');
  });

  it('collapses a branch and puts it back', () => {
    renderChart();

    fireEvent.click(screen.getByRole('button', { name: 'Hide 2 reports' }));
    expect(cardNames().sort()).toEqual(['Ada Lovelace']);

    fireEvent.click(screen.getByRole('button', { name: 'Show 2 reports' }));
    expect(cardNames()).toHaveLength(4);
  });

  it('hides a contract type and reattaches its reports to the nearest visible ancestor', () => {
    renderChart();

    fireEvent.click(screen.getByRole('button', { name: 'External' }));
    // The address carries the name, never the identifier.
    expect(search()).toBe('/portfolio/contributors?view=org&hide=External');
    expect(cardNames().sort()).toEqual(['Ada Lovelace', 'Ben Carter', 'Dan Reed']);

    fireEvent.click(screen.getByRole('button', { name: 'External' }));
    expect(search()).toBe('/portfolio/contributors?view=org');
    expect(cardNames()).toHaveLength(4);
  });

  it('names the manager it skipped when hovering a reattached card', async () => {
    renderChart('/portfolio/contributors?view=org&hide=External');

    fireEvent.mouseOver(card('Dan Reed'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Reports through Cleo Marsh');
  });

  it('reads the hidden contract types out of the address on arrival', () => {
    renderChart('/portfolio/contributors?view=org&hide=External');
    expect(cardNames().sort()).toEqual(['Ada Lovelace', 'Ben Carter', 'Dan Reed']);
  });

  it('roots the chart on one contributor', () => {
    renderChart('/portfolio/contributors?view=org&root=MEM-3');
    expect(cardNames().sort()).toEqual(['Cleo Marsh', 'Dan Reed']);
  });

  it('still reads a root saved in the address before MEM-n, as CTR-n', () => {
    renderChart('/portfolio/contributors?view=org&root=CTR-3');
    expect(cardNames().sort()).toEqual(['Cleo Marsh', 'Dan Reed']);
  });

  it('changes the root from the picker and records it in the address', () => {
    renderChart();

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Start from' }));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Cleo Marsh'));

    expect(search()).toBe('/portfolio/contributors?view=org&root=MEM-3');
    expect(cardNames().sort()).toEqual(['Cleo Marsh', 'Dan Reed']);
  });

  it('keeps the levels asked for and drops the chevron at the bottom one', () => {
    renderChart();

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Levels' }));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('1 level'));

    expect(search()).toBe('/portfolio/contributors?view=org&depth=1');
    expect(cardNames().sort()).toEqual(['Ada Lovelace', 'Ben Carter', 'Cleo Marsh']);
    // Only Ada keeps a chevron: Cleo's report is below the last visible level.
    expect(screen.getAllByRole('button', { name: /^Hide \d+ report/ })).toHaveLength(1);
  });

  it('brings the disabled accounts back on demand', () => {
    renderChart();

    fireEvent.click(screen.getByRole('button', { name: 'Include disabled accounts' }));
    expect(search()).toBe('/portfolio/contributors?view=org&disabled=1');
    expect(cardNames()).toContain('Eve Nunes');
  });

  it('exports the whole chart as a PNG, folded branches marked as such', async () => {
    renderChart();
    expect(action.label).toBe('Export PNG');

    fireEvent.click(screen.getByRole('button', { name: 'Hide 2 reports' }));
    action.run!();

    await waitFor(() => expect(exportOrgChartAsPng).toHaveBeenCalledTimes(1));
    const call = vi.mocked(exportOrgChartAsPng).mock.calls[0][0];
    // Folding only prunes the drawing; the export still says what was folded.
    expect(call.nodes.map((node) => node.name)).toEqual(['Ada Lovelace']);
    expect(call.nodes[0].hiddenReports).toBe(2);
    expect(call.nodes[0]).toMatchObject({ jobTitle: 'Head of IT', contractType: 'Internal', skillCount: 2, initials: 'AL' });
    expect(call.links).toEqual([]);
    expect(call.fileName).toMatch(/^org-chart-\d{4}-\d{2}-\d{2}$/);
  });

  it('stamps the export date on the image, never as an ISO string', async () => {
    renderChart();
    action.run!();

    await waitFor(() => expect(exportOrgChartAsPng).toHaveBeenCalledTimes(1));
    expect(vi.mocked(exportOrgChartAsPng).mock.calls[0][0].caption).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
  });

  it('falls back to the forest when the requested root is filtered out of it', async () => {
    // MEM-3 is the external one: hiding that contract type drops the requested
    // root, so the chart shows everyone rather than an empty branch.
    renderChart('/portfolio/contributors?view=org&root=MEM-3&hide=External');

    expect(cardNames().sort()).toEqual(['Ada Lovelace', 'Ben Carter', 'Dan Reed']);
    expect(screen.getByRole('combobox', { name: 'Start from' })).toHaveTextContent('Everyone');
  });

  it('says so, and offers nothing to export, when every contract type is switched off', () => {
    renderChart('/portfolio/contributors?view=org&hide=Internal,External');

    expect(screen.getByText('Every contributor is hidden by the filters above.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Reporting line' })).toBeNull();
    expect(action.label).toBeNull();
  });
});
