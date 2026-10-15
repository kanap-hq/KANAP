import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import i18n from '../../../i18n';
import { formatShortDate } from '../../../lib/dateFormat';
import { formatWeekLabel } from '../../../lib/isoWeek';
import {
  buildExplanationTexts,
  formatReasonLabel,
  formatRoadmapDays,
  type RoadmapExplanationInput,
} from './roadmap-text';

const tFor = (lng: string) => i18n.getFixedT(lng, 'portfolio') as unknown as TFunction;

const base: RoadmapExplanationInput = {
  classification: 'scheduled',
  startReason: 'capacity_available',
  earliestEligibleWeek: '2026-10-19',
  actualStartWeek: '2026-10-19',
  activeConstraint: null,
  blockerReasons: [],
};

describe('roadmap explanation texts', () => {
  it('builds the sentences in the reader\'s language with formatted dates', () => {
    const { summary, finalReason } = buildExplanationTexts(tFor('fr'), 'fr', base, {
      projectName: 'ERP',
      actualEndWeek: null,
    });
    expect(finalReason).toBe(`Démarré la semaine du ${formatShortDate('2026-10-19', 'fr')}.`);
    expect(finalReason).toContain('19 oct.');
    expect(summary).toContain('ERP');
    expect(summary).not.toMatch(/started|2026-10-19/);
  });

  it('names the classification of the start: capacity, blockers, unschedulable', () => {
    const capacity = buildExplanationTexts(tFor('de'), 'de', { ...base, earliestEligibleWeek: '2026-10-05' }, {
      projectName: 'ERP',
      actualEndWeek: null,
    });
    expect(capacity.finalReason).not.toMatch(/Eligible|2026-/);
    const unschedulable = buildExplanationTexts(
      tFor('es'),
      'es',
      { ...base, classification: 'unschedulable', actualStartWeek: null, startReason: 'unscheduled' },
      { projectName: 'ERP', actualEndWeek: null, unschedulableReason: 'no_free_slot' },
    );
    expect(unschedulable.finalReason).toBe('Sin hueco libre');
    expect(unschedulable.summary).toContain('ERP');
    expect(unschedulable.summary).not.toMatch(/could not/);
  });

  it('rewrites a constraint conflict instead of the server\'s English text', () => {
    const explanation: RoadmapExplanationInput = {
      ...base,
      startReason: 'constraint_pin_start',
      actualStartWeek: '2026-11-02',
      activeConstraint: { type: 'pin_start', startWeek: '2026-10-19' },
      blockerReasons: [{
        kind: 'constraint_conflict',
        label: 'Pinned start 2026-10-19 slipped to 2026-11-02.',
        projectId: 'p1',
        fromWeek: '2026-10-19',
        toWeek: '2026-11-02',
      }],
    };
    const label = formatReasonLabel(tFor('fr'), 'fr', explanation, explanation.blockerReasons[0], null);
    expect(label).toContain('19 oct.');
    expect(label).toContain('2 nov.');
    expect(label).not.toMatch(/Pinned|2026-/);
  });

  it('writes days with the reader\'s decimal separator', () => {
    expect(formatRoadmapDays('fr', 6.444)).toBe('6,44');
    expect(formatRoadmapDays('en', 6.444)).toBe('6.44');
  });

  it('labels weeks per language with the ISO week number', () => {
    const monday = new Date(2026, 9, 19);
    expect(formatWeekLabel(tFor('fr'), monday)).toBe('S43');
    expect(formatWeekLabel(tFor('de'), monday)).toBe('KW43');
    expect(formatWeekLabel(tFor('en'), monday)).toBe('W43');
  });
});
