import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import { formatShortDateTime } from '../../../lib/dateFormat';
import portfolioEn from '../../../locales/en/portfolio.json';
import itEn from '../../../locales/en/it.json';
import PortfolioHistory from './PortfolioHistory';

function resolveKey(key: string, opts?: Record<string, unknown>): string | undefined {
  const [source, path] = key.startsWith('it:') ? [itEn, key.slice(3)] : [portfolioEn, key];
  const read = (candidate: string) => candidate
    .split('.')
    .reduce<any>((node, part) => (node == null ? undefined : node[part]), source);
  if (typeof opts?.count === 'number') {
    const plural = read(`${path}_${opts.count === 1 ? 'one' : 'other'}`);
    if (typeof plural === 'string') return plural;
  }
  return read(path);
}

const translate = (key: string, opts?: Record<string, unknown>) => {
  const template = resolveKey(key, opts);
  if (typeof template !== 'string') return key;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(opts?.[name] ?? ''));
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));

vi.mock('../../../i18n/useLocale', () => ({ useLocale: () => 'en' }));

const theme = createAppTheme('light');

function renderHistory(props: Partial<React.ComponentProps<typeof PortfolioHistory>> = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <PortfolioHistory entityType="project" activities={[]} {...props} />
    </ThemeProvider>,
  );
}

describe('PortfolioHistory', () => {
  const changeActivity = {
    id: 'a-1',
    type: 'change' as const,
    content: null,
    context: null,
    decision_outcome: null,
    author_id: null,
    first_name: 'Clara',
    last_name: 'Dupont',
    created_at: '2026-09-01T10:00:00Z',
    changed_fields: { status: ['planned', 'in_progress'] as [string, string] },
  };

  it('shows the creation as a feed entry with its author, date and time', () => {
    renderHistory({ createdAt: '2026-08-22T11:06:40Z', createdByName: 'Thomas Berger' });
    expect(screen.getByText(portfolioEn.activity.labels.created)).toBeInTheDocument();
    const meta = screen.getByText(/Thomas Berger/);
    // Same meta line as every other entry: author, then date *and* time.
    expect(meta.textContent).toContain(formatShortDateTime('2026-08-22T11:06:40Z', 'en'));
  });

  it('keeps the creation entry when the author is unknown', () => {
    renderHistory({ createdAt: '2026-08-22T11:06:40Z', createdByName: null });
    expect(screen.getByText(portfolioEn.activity.labels.created)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(portfolioEn.activity.authorUnknown))).toBeInTheDocument();
  });

  it('places the creation after every recorded change', () => {
    renderHistory({
      createdAt: '2026-08-22T11:06:40Z',
      createdByName: 'Thomas Berger',
      activities: [{ ...changeActivity, created_at: '2026-08-22T11:06:49Z' }],
    });
    const change = screen.getByText('Status: planned → in_progress');
    const created = screen.getByText(portfolioEn.activity.labels.created);
    // The feed is newest first: the creation sits below the change it precedes.
    expect(created.compareDocumentPosition(change) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('shows the creation entry even when no change was ever recorded', () => {
    renderHistory({ createdAt: '2026-08-22T11:06:40Z', createdByName: null });
    expect(screen.getByText(portfolioEn.activity.labels.created)).toBeInTheDocument();
    expect(screen.queryByText(portfolioEn.activity.messages.noHistory)).not.toBeInTheDocument();
  });

  it('shows the empty message when there is neither a change nor a creation date', () => {
    renderHistory({ activities: [] });
    expect(screen.getByText(portfolioEn.activity.messages.noHistory)).toBeInTheDocument();
    expect(screen.queryByText(portfolioEn.activity.labels.created)).not.toBeInTheDocument();
  });

  it('falls back to the author email when the account has no name', () => {
    renderHistory({
      activities: [{
        id: 'a-1',
        type: 'change',
        content: null,
        context: null,
        decision_outcome: null,
        author_id: 'u-1',
        first_name: null,
        last_name: null,
        email: 'admin@kanap.net',
        created_at: '2026-09-01T10:00:00Z',
        changed_fields: { status: ['planned', 'in_progress'] },
      }],
    });
    expect(screen.getByText(/admin@kanap\.net/)).toBeInTheDocument();
    expect(screen.queryByText(/Unknown/)).not.toBeInTheDocument();
  });

  describe('managed document edits', () => {
    const documentActivity = (overrides: Record<string, unknown>) => ({
      id: 'a-doc',
      type: 'change' as const,
      content: null,
      context: null,
      decision_outcome: null,
      author_id: null,
      first_name: null,
      last_name: null,
      created_at: '2026-09-01T10:00:00Z',
      ...overrides,
    });

    it('labels a stored document update with the document name', () => {
      renderHistory({
        activities: [documentActivity({ changed_fields: { document_updated: [null, 'purpose'] } })],
      });
      expect(screen.getByText('Purpose updated')).toBeInTheDocument();
    });

    it('labels a legacy document update written as a sentence', () => {
      renderHistory({
        activities: [documentActivity({ content: 'Risks & Mitigations updated' })],
      });
      expect(screen.getByText('Risks updated')).toBeInTheDocument();
    });

    it('never shows a blank line for an unlabelled change', () => {
      renderHistory({
        activities: [documentActivity({ content: 'Imported from legacy project field' })],
      });
      expect(screen.getByText('Imported from legacy project field')).toBeInTheDocument();
    });
  });

  describe('budget lines outside the access', () => {
    const linesActivity = (changed: Record<string, [unknown, unknown]>) => ({
      ...changeActivity,
      id: 'a-lines',
      changed_fields: changed,
    });

    it('names the readable lines and counts the others', () => {
      renderHistory({ activities: [linesActivity({ opex_items: [['Licence'], { labels: ['Licence'], hidden: 1 }] })] });
      expect(screen.getByText('OPEX lines: Licence → Licence and 1 line outside your access')).toBeInTheDocument();
    });

    it('counts every line for a reader who sees none of them', () => {
      renderHistory({ activities: [linesActivity({ capex_items: [{ labels: [], hidden: 2 }, []] })] });
      expect(screen.getByText(/2 lines outside your access/)).toBeInTheDocument();
    });

    it('gives the number of lines only without the budget right', () => {
      renderHistory({ activities: [linesActivity({ opex_items: [{ labels: null, hidden: 1 }, { labels: null, hidden: 3 }] })] });
      expect(screen.getByText('OPEX lines: 1 budget line → 3 budget lines')).toBeInTheDocument();
      expect(screen.queryByText(/object Object/)).not.toBeInTheDocument();
    });
  });

  describe('scoring rows', () => {
    it('hides the legacy identifier maps but keeps the score change', () => {
      renderHistory({
        activities: [{
          id: 'a-score',
          type: 'change',
          content: null,
          context: null,
          decision_outcome: null,
          author_id: null,
          first_name: null,
          last_name: null,
          created_at: '2026-09-01T10:00:00Z',
          changed_fields: {
            priority_score: ['63.33', 60.83],
            criteria_values: [
              { '26a52f05-2a1c-4107-9eb0-0efa0f56bd78': '0a51b2ab-0f2a-48fb-938e-bcfb3b930431' },
              { '26a52f05-2a1c-4107-9eb0-0efa0f56bd78': '23b37011-4293-4974-becf-9ddd9b5d9a92' },
            ],
          },
        }],
      });
      expect(screen.getByText('Priority score: 63.33 → 60.83')).toBeInTheDocument();
      expect(screen.queryByText(/object Object/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Evaluation criteria/)).not.toBeInTheDocument();
    });

    it('renders the readable criteria diff written by the new format', () => {
      renderHistory({
        activities: [{
          id: 'a-score-2',
          type: 'change',
          content: null,
          context: null,
          decision_outcome: null,
          author_id: null,
          first_name: null,
          last_name: null,
          created_at: '2026-09-01T10:00:00Z',
          changed_fields: {
            criteria_values: [
              ['Time estimation IT: < 3 months'],
              ['Time estimation IT: 3-6 months'],
            ],
          },
        }],
      });
      expect(screen.getByText('Evaluation criteria: Time estimation IT: < 3 months → Time estimation IT: 3-6 months'))
        .toBeInTheDocument();
    });

    it('keeps the feasibility review readable (object values are not masked)', () => {
      renderHistory({
        activities: [{
          id: 'a-feas',
          type: 'change',
          content: null,
          context: null,
          decision_outcome: null,
          author_id: null,
          first_name: null,
          last_name: null,
          created_at: '2026-09-01T10:00:00Z',
          changed_fields: {
            feasibility_review: [
              { technical_feasibility: { status: 'not_assessed' } },
              { technical_feasibility: { status: 'feasible' } },
            ],
          },
        }],
      });
      // The object-valued feasibility review keeps its readable summary: the
      // mask only ever targets the legacy identifier maps.
      expect(screen.getByText(/Feasibility review: .*Technical feasibility:/)).toBeInTheDocument();
      expect(screen.queryByText(/object Object/)).not.toBeInTheDocument();
    });
  });
});
