import '../../../i18n';
import i18n from '../../../i18n';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import ReachVulnerabilitiesSection, {
  REACH_VULNERABILITIES_ANCHOR,
  type ReachVulnerabilities,
  type ReachVulnerabilityRow,
} from './ReachVulnerabilitiesSection';

vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal<any>()), useNavigate: () => vi.fn() }));

const row = (over: Partial<ReachVulnerabilityRow>): ReachVulnerabilityRow => ({
  technology: { id: 'tech-1', name: 'Tomcat', reference: 'TEC-7' },
  version_id: 'v-1',
  label: '9.0.80',
  open: { critical: 1, high: 2, medium: 0, low: 1, none: 2, unknown: 0 },
  total: 6,
  severe: 3,
  exploited_severe: 1,
  ...over,
});

function renderSection(props: Partial<React.ComponentProps<typeof ReachVulnerabilitiesSection>> & { data: ReachVulnerabilities }, mode: 'light' | 'dark' = 'light') {
  return render(
    <ThemeProvider theme={createAppTheme(mode)}>
      <MemoryRouter>
        <ReachVulnerabilitiesSection kind="asset" subjectReference="AST-12" {...props} />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('ReachVulnerabilitiesSection', () => {
  it('shows one line per technology and version, None counted with Low, and links to the filtered page', () => {
    const { container } = renderSection({
      data: {
        rows: [row({}), row({ technology: { id: 'tech-2', name: 'OpenSSL', reference: 'TEC-9' }, version_id: null, label: null, open: { critical: 0, high: 0, medium: 1, low: 0, none: 0, unknown: 1 }, total: 2, severe: 0, exploited_severe: 0 })],
        totals: { open: 8, severe: 3, exploited_severe: 1 },
      },
    }, 'dark');
    expect(container.querySelector(`#${REACH_VULNERABILITIES_ANCHOR}`)).not.toBeNull();
    const table = screen.getByRole('table', { name: 'Vulnerabilities' });
    // Abbreviated severity headers, the full name for screen readers and in the tooltip.
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((th) => th.querySelector('[data-short]')?.textContent ?? th.textContent))
      .toEqual(['Technology', 'Version', 'Crit.', 'High', 'Med.', 'Low', 'N/R', 'Total', '']);
    for (const name of ['Critical', 'High', 'Medium', 'Low', 'Not rated']) {
      expect(within(table).getByRole('columnheader', { name })).toBeTruthy();
    }
    const rows = within(table).getAllByRole('row').slice(1);
    // Low shows low + none (1 + 2); a zero is a quiet dot.
    expect(rows[0].textContent).toBe('Tomcat9.0.8012·3·6See');
    expect(rows[1].textContent).toBe('OpenSSLVersion not recorded (potentially concerned)··1·12See');
    expect(within(rows[0]).getByRole('link', { name: 'See' }).getAttribute('href')).toBe('/it/vulnerabilities?asset=AST-12&technology=TEC-7');
    // The count next to the title: distinct CVE to review.
    expect(screen.getByRole('region', { name: 'Vulnerabilities' }).textContent).toMatch(/^Vulnerabilities8/);
    // It opens the Vulnerabilities page filtered on the record.
    const count = screen.getByRole('link', { name: 'See the 8 vulnerabilities to review on the Vulnerabilities page' });
    expect(count.textContent).toBe('8');
    expect(count.getAttribute('href')).toBe('/it/vulnerabilities?asset=AST-12');
    expect(screen.queryByTestId('reach-indirect')).toBeNull();
  });

  it('names the servers of an application, or says the line is only declared with the reminder', () => {
    const onRecordOnServer = vi.fn();
    renderSection({
      kind: 'application',
      subjectReference: 'APP-3',
      onRecordOnServer,
      data: {
        rows: [
          row({ servers: [{ id: 's-1', name: 'SRV-WEB-01' }, { id: 's-2', name: 'SRV-WEB-02' }], declared: true }),
          row({ technology: { id: 'tech-2', name: 'PostgreSQL', reference: 'TEC-4' }, servers: [], declared: true }),
        ],
        totals: { open: 6, severe: 3, exploited_severe: 1 },
      },
    });
    const table = screen.getByRole('table', { name: 'Vulnerabilities' });
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toContain('Servers');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0].textContent).toContain('SRV-WEB-01, SRV-WEB-02');
    expect(rows[1].textContent).toContain('Declared');
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Record on a server' }));
    expect(onRecordOnServer).toHaveBeenCalledWith(expect.objectContaining({ technology: expect.objectContaining({ id: 'tech-2' }) }), expect.anything());
    expect(within(rows[1]).getByRole('link', { name: 'See' }).getAttribute('href')).toBe('/it/vulnerabilities?application=APP-3&technology=TEC-4');
  });

  it('shows "Declared" alone without the record action', () => {
    renderSection({ kind: 'application', subjectReference: 'APP-3', data: { rows: [row({ servers: [], declared: true })], totals: { open: 6, severe: 3, exploited_severe: 1 } } });
    expect(screen.getByText('Declared')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record on a server' })).toBeNull();
  });

  it('lists apart, without counting them, the technologies another asset carries', () => {
    renderSection({
      data: {
        rows: [],
        indirect: [row({ technology: { id: 'tech-3', name: 'VMware ESXi', reference: 'TEC-2' }, via: { id: 'a-9', name: 'PAR-ESX-01', reference: 'AST-9' } })],
        totals: { open: 0, severe: 0, exploited_severe: 0 },
      },
    });
    expect(screen.getByText('No vulnerability to review on this asset.')).toBeTruthy();
    const part = screen.getByTestId('reach-indirect');
    expect(part.textContent).toContain('Through another asset');
    expect(part.textContent).toContain('Not counted');
    const indirect = within(part).getByRole('table', { name: 'Through another asset' });
    const line = within(indirect).getAllByRole('row')[1];
    expect(line.textContent).toContain('PAR-ESX-01');
    expect(line.textContent).not.toContain('through');
    expect(within(line).getByRole('link', { name: 'See' }).getAttribute('href')).toBe('/it/vulnerabilities?asset=AST-9&technology=TEC-2');
    // No count next to the title: nothing counts.
    expect(screen.getByRole('region', { name: 'Vulnerabilities' }).querySelector('h2')?.nextSibling).toBeNull();
  });

  it('names every asset that carries an indirect line, once, each a link to its page', () => {
    renderSection({
      data: {
        rows: [],
        indirect: [row({
          technology: { id: 'tech-3', name: 'Microsoft SQL Server Enterprise Edition with a very long name', reference: 'TEC-2' },
          via: { id: 'a-1', name: 'PAR-SQL-01', reference: 'AST-1' },
          via_assets: [{ id: 'a-1', name: 'PAR-SQL-01', reference: 'AST-1' }, { id: 'a-2', name: 'PAR-SQL-02', reference: 'AST-2' }],
        })],
        totals: { open: 0, severe: 0, exploited_severe: 0 },
      },
    });
    const indirect = within(screen.getByTestId('reach-indirect')).getByRole('table', { name: 'Through another asset' });
    const lines = within(indirect).getAllByRole('row').slice(1);
    expect(lines).toHaveLength(1);
    expect(within(lines[0]).getByRole('link', { name: 'PAR-SQL-01' }).getAttribute('href')).toBe('/it/assets/a-1/overview');
    expect(within(lines[0]).getByRole('link', { name: 'PAR-SQL-02' }).getAttribute('href')).toBe('/it/assets/a-2/overview');
    expect(within(lines[0]).getByTitle('PAR-SQL-01, PAR-SQL-02')).toBeTruthy();
    // A long technology name is cut by the ellipsis, whole on hover; the counts keep their fixed room.
    expect(within(lines[0]).getByTitle('Microsoft SQL Server Enterprise Edition with a very long name')).toBeTruthy();
    expect(lines[0].querySelector('td.w')?.textContent).toBe('9.0.80');
  });

  it('counts a cluster on its members too: the count after the title follows member_totals', () => {
    renderSection({
      data: { rows: [], totals: { open: 0, severe: 0, exploited_severe: 0 }, member_totals: { open: 9, severe: 4, exploited_severe: 1 } },
    });
    expect(screen.getByTestId('reach-vulnerabilities-count').textContent).toBe('9');
  });

  it('fits a record page with its properties panel open: no horizontal scroll, long cells wrap', () => {
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(700);
    try {
      renderSection({
        kind: 'application',
        subjectReference: 'APP-42',
        onRecordOnServer: vi.fn(),
        data: {
          rows: [row({ label: null, servers: [], declared: true })],
          totals: { open: 6, severe: 3, exploited_severe: 1 },
        },
      });
      const table = screen.getByRole('table', { name: 'Vulnerabilities' });
      // The table needs no width beyond its frame: no horizontal bar.
      expect(table.style.minWidth).toBe('');
      const cells = within(table).getAllByRole('row')[1].querySelectorAll('td');
      for (const index of [0, 1, 2]) {
        const style = getComputedStyle(cells[index]);
        expect(style.textOverflow).not.toBe('ellipsis');
        expect(style.whiteSpace).toBe('normal');
      }
      // "Record on a server" sits on its own line, under "Declared".
      expect(getComputedStyle(cells[2].querySelector('[data-declared]')!).flexDirection).toBe('column');
      // The severity headers show the abbreviation; the name stays for screen readers.
      expect(within(table).getAllByRole('columnheader', { name: 'Critical' })).toHaveLength(1);
    } finally {
      width.mockRestore();
    }
  });

  it('hides the severity names of the compact headers in a 1px box', () => {
    renderSection({ data: { rows: [row({})], totals: { open: 6, severe: 3, exploited_severe: 1 } } });
    const header = screen.getAllByRole('columnheader').find((cell) => cell.querySelector('[data-severity="critical"]'))!;
    const label = Array.from(header.querySelectorAll('span')).find((span) => span.textContent === 'Critical' && span.children.length === 0)!;
    const style = getComputedStyle(label);
    // A label as wide as the record would give the whole page a horizontal bar.
    expect(style.position).toBe('absolute');
    expect(style.width).toBe('1px');
    expect(style.height).toBe('1px');
    expect(style.overflow).toBe('hidden');
    expect(style.margin).toBe('-1px');
  });

  it('gives the compact severity columns room for a four-digit count', () => {
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(700);
    try {
      renderSection({ data: { rows: [row({ open: { critical: 2617, high: 0, medium: 0, low: 0, none: 0, unknown: 0 }, total: 2617 })], totals: null } });
      const table = screen.getByRole('table', { name: 'Vulnerabilities' });
      const headers = within(table).getAllByRole('columnheader');
      const cols = table.querySelectorAll('col');
      const severityIndexes = headers.map((cell, index) => (cell.querySelector('[data-severity]') ? index : -1)).filter((index) => index >= 0);
      expect(severityIndexes).toHaveLength(5);
      for (const index of severityIndexes) expect((cols[index] as HTMLElement).style.width).toBe('52px');
      expect(within(table).getAllByRole('row')[1].querySelectorAll('td')[severityIndexes[0]].textContent).toBe('2617');
    } finally {
      width.mockRestore();
    }
  });

  it('keeps the version whole and wraps it on spaces, in an application table of 680px', () => {
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(680);
    try {
      renderSection({
        kind: 'application',
        subjectReference: 'APP-42',
        data: { rows: [row({ label: null, servers: [{ id: 's-1', name: 'srv-app-01' }] })], totals: { open: 6, severe: 3, exploited_severe: 1 } },
      });
      const table = screen.getByRole('table', { name: 'Vulnerabilities' });
      expect(table.style.minWidth).toBe('');
      const headers = within(table).getAllByRole('columnheader');
      const versionIndex = headers.findIndex((cell) => cell.textContent === 'Version');
      // "(möglicherweise" is 102px wide in 13px, plus the 8px cell padding.
      expect(parseInt((table.querySelectorAll('col')[versionIndex] as HTMLElement).style.width, 10)).toBeGreaterThanOrEqual(110);
      const text = within(table).getByText('Version not recorded (potentially concerned)');
      const style = getComputedStyle(text);
      expect(style.overflowWrap).toBe('normal');
      expect(style.wordBreak).toBe('normal');
    } finally {
      width.mockRestore();
    }
  });

  it('fits an application table of 680px with whole abbreviations, in every language, without a horizontal bar', async () => {
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(680);
    const expected: Record<string, string[]> = {
      en: ['Crit.', 'High', 'Med.', 'Low', 'N/R'],
      fr: ['Crit.', 'Élev.', 'Moy.', 'Faible', 'N. éval.'],
      de: ['Krit.', 'Hoch', 'Mittel', 'Niedrig', 'N. bew.'],
      es: ['Crít.', 'Alta', 'Media', 'Baja', 'S. eval.'],
    };
    try {
      for (const [language, labels] of Object.entries(expected)) {
        await i18n.changeLanguage(language);
        const { unmount } = renderSection({
          kind: 'application',
          subjectReference: 'APP-42',
          data: { rows: [row({ servers: [{ id: 's-1', name: 'srv-app-01' }] })], totals: { open: 6, severe: 3, exploited_severe: 1 } },
        });
        const table = screen.getByRole('table');
        expect(Array.from(table.querySelectorAll('[data-short]')).map((span) => span.textContent)).toEqual(labels);
        // Every column with a width keeps its own: nothing goes below its floor, the frame does not scroll.
        expect(getComputedStyle(table).minWidth).not.toMatch(/px$/);
        const cols = Array.from(table.querySelectorAll('col')).map((col) => (col as HTMLElement).style.width);
        expect(cols.filter((w) => w === '52px')).toHaveLength(5);
        unmount();
      }
    } finally {
      await i18n.changeLanguage('en');
      width.mockRestore();
    }
  });

  it('says in one line that nothing is to review', () => {
    renderSection({ kind: 'application', subjectReference: 'APP-3', data: { rows: [], totals: null } });
    expect(screen.getByText('No vulnerability to review on this application.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
