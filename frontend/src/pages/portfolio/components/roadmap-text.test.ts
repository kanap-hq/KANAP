import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import i18n from '../../../i18n';
import { formatShortDate } from '../../../lib/dateFormat';
import { formatWeekLabel } from '../../../lib/isoWeek';
import {
  buildExplanationTexts,
  formatReasonLabel,
  formatRoadmapDays,
  formatRoadmapText,
  ROADMAP_TEXT_CODES,
  type RoadmapExplanationInput,
  type RoadmapText,
} from './roadmap-text';

const tFor = (lng: string) => i18n.getFixedT(lng, 'portfolio') as unknown as TFunction;

const text = (code: RoadmapText['code'], params: RoadmapText['params'] = {}): RoadmapText => ({ code, params });
const pin = { type: 'pin_start' as const, startWeek: '2026-10-19' };
const slipped = text('conflict_pin_start_slipped', { week: '2026-10-19', actual: '2026-11-02' });
const alice = text('contributor_capacity', { name: 'Alice', weeklyCapacity: 4.62 });

/** One sample per code the server writes, with the parameters it sends. */
const samples: Record<RoadmapText['code'], RoadmapText['params']> = {
  missing_contributor_capacity_for: { names: ['Alice', 'Bob'] },
  blocker_on_hold: { blocker: 'CRM' },
  blocker_fixed_plan_expired: { blocker: 'CRM' },
  blocker_cannot_be_scheduled: { blocker: 'CRM', reason: 'no_free_slot' },
  missing_blocker_date_for: { blocker: 'CRM' },
  no_free_slot_for: { contributors: [alice] },
  no_allocable_capacity_for: { contributors: [alice] },
  collaborative_burn_below_threshold: { burn: 0.25, threshold: 0.5 },
  collaborative_burn_stalled_for: { contributors: [alice] },
  independent_burn_below_threshold: { burn: 0.25, threshold: 0.5 },
  no_capacity_remained_for: { contributors: [alice] },
  capacity_prevented_scheduling: {},
  waiting_on_blockers: { blockers: ['CRM', 'ERP'] },
  earliest_start_beyond_horizon: { week: '2027-03-01', horizonWeeks: 52 },
  never_ready_within_horizon: {},
  remaining_after_horizon: {
    remainingDays: 12.5,
    horizonWeeks: 52,
    loads: [text('contributor_remaining_load', { name: 'Alice', remainingDays: 12.5, weeklyCapacity: 4.62 })],
  },
  no_allocable_week: {},
  reason: { reason: 'no_free_slot' },
  contributor_capacity: { name: 'Alice', weeklyCapacity: 4.62 },
  contributor_remaining_load: { name: 'Alice', remainingDays: 12.5, weeklyCapacity: 4.62 },
  waiting_for: { blocker: 'CRM' },
  waiting_for_until: { blocker: 'CRM', week: '2026-10-19' },
  blocker_is_on_hold: { blocker: 'CRM' },
  blocker_has_expired_fixed_plan: { blocker: 'CRM' },
  blocker_is_unschedulable: { blocker: 'CRM', reason: 'cyclic_dependency' },
  conflict_pin_start_unsatisfied: { week: '2026-10-19' },
  conflict_pin_start_normalized: { week: '2026-10-21', normalized: '2026-10-19', actual: '2026-11-02' },
  conflict_pin_start_slipped: { week: '2026-10-19', actual: '2026-11-02' },
  conflict_pin_window_unsatisfied: { start: '2026-10-19', end: '2026-12-18' },
  conflict_pin_window_missed: { start: '2026-10-19', end: '2026-12-18', actualStart: '2026-11-02', actualEnd: '2027-01-08' },
  conflict_not_before_violated: { week: '2026-10-19', actual: '2026-10-12' },
  final_capacity: { eligible: '2026-10-05', week: '2026-10-19' },
  final_blockers: { week: '2026-10-19' },
  final_started: { week: '2026-10-19' },
  summary_unschedulable: { project: 'ERP', reason: alice },
  summary_historical: { project: 'ERP', week: '2026-10-19' },
  summary_constraint: { project: 'ERP', week: '2026-10-19', constraint: pin },
  summary_constraint_conflict: { project: 'ERP', week: '2026-11-02', constraint: pin, conflict: slipped },
  summary_capacity: { project: 'ERP', eligible: '2026-10-05', week: '2026-10-19' },
  summary_blockers: { project: 'ERP', week: '2026-10-19' },
  summary_schedulable: { project: 'ERP', week: '2026-10-19' },
  warning_constraint_conflict: { project: 'ERP', conflict: slipped },
};

const base: RoadmapExplanationInput = {
  summaryText: text('summary_schedulable', { project: 'ERP', week: '2026-10-19' }),
  finalReasonText: text('final_started', { week: '2026-10-19' }),
};

describe('roadmap texts', () => {
  it('writes every code the server sends, in every language, with no English or raw value left', () => {
    expect(Object.keys(samples).sort()).toEqual([...ROADMAP_TEXT_CODES].sort());
    for (const lng of ['en', 'fr', 'de', 'es']) {
      for (const code of ROADMAP_TEXT_CODES) {
        const sentence = formatRoadmapText(tFor(lng), lng, text(code, samples[code]));
        expect(sentence, `${lng} ${code}`).not.toMatch(/\{\{|planning\.roadmap|\d{4}-\d{2}-\d{2}|_/);
        expect(sentence, `${lng} ${code}`).not.toBe('');
      }
    }
  });

  it('formats dates, days and lists in the reader\'s language', () => {
    const fr = tFor('fr');
    expect(formatRoadmapText(fr, 'fr', text('no_free_slot_for', samples.no_free_slot_for)))
      .toBe('Aucun créneau parallèle libre pour : Alice (4,62 j/semaine)');
    expect(formatRoadmapText(fr, 'fr', text('waiting_for_until', samples.waiting_for_until)))
      .toBe(`En attente de CRM jusqu'à la semaine du ${formatShortDate('2026-10-19', 'fr')}`);
    expect(formatRoadmapText(tFor('de'), 'de', text('waiting_on_blockers', samples.waiting_on_blockers)))
      .toBe('Wartet noch auf die Blocker: CRM, ERP');
    expect(formatRoadmapText(tFor('es'), 'es', text('blocker_is_unschedulable', samples.blocker_is_unschedulable)))
      .toBe('CRM no se puede planificar: Dependencia cíclica');
    expect(formatRoadmapText(tFor('en'), 'en', text('remaining_after_horizon', samples.remaining_after_horizon)))
      .toBe('12.5 d remaining after 52 weeks. Biggest unresolved loads: Alice: 12.5 d remaining at 4.62 d/week');
  });

  it('nests the reason of an unschedulable project and the conflict of a warning', () => {
    const fr = tFor('fr');
    expect(formatRoadmapText(fr, 'fr', text('summary_unschedulable', samples.summary_unschedulable)))
      .toBe("ERP n'a pas pu être planifié : Alice (4,62 j/semaine)");
    expect(formatRoadmapText(fr, 'fr', text('warning_constraint_conflict', samples.warning_constraint_conflict)))
      .toBe(`ERP : Le début épinglé au ${formatShortDate('2026-10-19', 'fr')} a glissé à la semaine du ${formatShortDate('2026-11-02', 'fr')}.`);
    expect(formatRoadmapText(fr, 'fr', text('summary_schedulable', { project: 'ERP', week: null })))
      .toBe("ERP n'a pas de semaine de début.");
  });
});

describe('roadmap explanation texts', () => {
  it('builds the summary and the final reason from the server codes', () => {
    const { summary, finalReason } = buildExplanationTexts(tFor('fr'), 'fr', base);
    expect(finalReason).toBe(`Démarré la semaine du ${formatShortDate('2026-10-19', 'fr')}.`);
    expect(finalReason).toContain('19 oct.');
    expect(summary).toContain('ERP');
    expect(summary).not.toMatch(/started|2026-10-19/);
    expect(buildExplanationTexts(tFor('fr'), 'fr', { ...base, finalReasonText: null }).finalReason).toBeNull();
  });

  it('writes a reason entry from its code', () => {
    const label = formatReasonLabel(tFor('fr'), 'fr', {
      label: 'Pinned start 2026-10-19 slipped to 2026-11-02.',
      labelText: slipped,
    });
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
