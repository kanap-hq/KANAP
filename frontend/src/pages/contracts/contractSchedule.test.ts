import { describe, expect, it } from 'vitest';
import { contractSchedule, daysBetween, DECISION_WINDOW_DAYS, fraction } from './contractSchedule';

const TODAY = '2026-10-12';

describe('contractSchedule', () => {
  it('a renewing contract still open to cancellation: deadline, days, urgency, timeline', () => {
    const schedule = contractSchedule({ start_date: '2023-07-01', duration_months: 12, notice_period_months: 6, auto_renewal: true }, TODAY)!;
    expect(schedule.state).toEqual({ kind: 'cancel', deadline: '2026-12-30', days: 79, urgent: true });
    expect(schedule.termNumber).toBe(4);
    expect([schedule.termStart, schedule.termEnd]).toEqual(['2026-07-01', '2027-06-30']);
    expect(schedule.renewals).toBe(3);
    expect(schedule.lastTerm).toBe(false);
    const timeline = schedule.timeline!;
    expect(timeline.segments.map((s) => [s.number, s.kind])).toEqual([
      [1, 'past'], [2, 'past'], [3, 'past'], [4, 'current'], [5, 'projected'],
    ]);
    expect(timeline.deadline).toBe('2026-12-30');
    expect(timeline.window).toEqual({ start: '2026-10-01', end: '2026-12-30' });
    expect(timeline.years).toEqual(['2024-01-01', '2025-01-01', '2026-01-01', '2027-01-01', '2028-01-01']);
    expect(fraction(timeline, timeline.from)).toBe(0);
    expect(fraction(timeline, timeline.to)).toBe(1);
  });

  it("draws the tenant's decision window, the default while the contract loads", () => {
    const input = { start_date: '2023-07-01', duration_months: 12, notice_period_months: 6, auto_renewal: true };
    const short = contractSchedule(input, TODAY, 30)!;
    expect(short.state).toEqual({ kind: 'cancel', deadline: '2026-12-30', days: 79, urgent: false });
    expect(short.timeline!.window).toEqual({ start: '2026-11-30', end: '2026-12-30' });
    expect(contractSchedule(input, TODAY, undefined)!.timeline!.window).toEqual({ start: '2026-10-01', end: '2026-12-30' });
  });

  it('a termination decided: the contract ends with its current term', () => {
    // The renewal decision sets the end of validity to the last day of the term (noon UTC).
    const schedule = contractSchedule(
      { start_date: '2023-07-01', duration_months: 12, notice_period_months: 6, auto_renewal: true, disabled_at: '2027-06-30T12:00:00.000Z' },
      TODAY,
    )!;
    expect(schedule.state).toEqual({ kind: 'ends', end: '2027-06-30', days: 261 });
    expect(schedule.lastTerm).toBe(true);
    expect(schedule.timeline!.window).toBeNull();
  });

  it('a renewal confirmed for the term: no deadline nor window, the next term runs', () => {
    const input = { start_date: '2023-07-01', duration_months: 12, notice_period_months: 6, auto_renewal: true };
    const confirmed = { term_end: '2027-06-30', renews_on: '2027-07-01', next_term_end: '2028-06-30' };
    const schedule = contractSchedule(input, TODAY, 90, confirmed)!;
    expect(schedule.state).toEqual({ kind: 'confirmed', nextStart: '2027-07-01', nextEnd: '2028-06-30' });
    expect(schedule.timeline!.deadline).toBeNull();
    expect(schedule.timeline!.window).toBeNull();
    expect(schedule.timeline!.segments.map((s) => s.kind)).toEqual(['past', 'past', 'past', 'current', 'next']);
    expect(schedule.lastTerm).toBe(false);
    // Another term's renewal (a past one), or dates changed since: the deadline is back.
    expect(contractSchedule(input, TODAY, 90, { term_end: '2026-06-30', renews_on: '2026-07-01', next_term_end: '2027-06-30' })!.state)
      .toMatchObject({ kind: 'cancel', deadline: '2026-12-30' });
    expect(contractSchedule({ ...input, notice_period_months: 3 }, TODAY, 90, confirmed)!.state.kind).toBe('confirmed');
    expect(contractSchedule({ ...input, start_date: '2023-08-01' }, TODAY, 90, confirmed)!.state.kind).toBe('cancel');
    // A termination since (end of validity on the term's last day): the contract ends.
    expect(contractSchedule({ ...input, disabled_at: '2027-06-30T12:00:00.000Z' }, TODAY, 90, confirmed)!.state.kind).toBe('ends');
  });

  it('is not urgent before the decision window', () => {
    const schedule = contractSchedule({ start_date: '2024-10-01', duration_months: 36, notice_period_months: 3, auto_renewal: true }, TODAY)!;
    expect(schedule.state).toMatchObject({ kind: 'cancel', deadline: '2027-06-30', urgent: false });
    expect(daysBetween(TODAY, '2027-06-30')).toBeGreaterThan(DECISION_WINDOW_DAYS);
  });

  it('a renewing contract past its notice runs one more term', () => {
    const schedule = contractSchedule({ start_date: '2024-01-01', duration_months: 36, notice_period_months: 6, auto_renewal: true }, TODAY)!;
    expect(schedule.state).toEqual({ kind: 'renewed', renewedUntil: '2029-12-31', nextDeadline: '2029-06-30' });
    // The next term will run: no longer "if renewed".
    expect(schedule.timeline!.segments.map((s) => s.kind)).toEqual(['current', 'next']);
    // The next deadline falls in the projected term: the timeline marks it.
    expect(schedule.timeline!.deadline).toBe('2029-06-30');
    expect(schedule.timeline!.window).toEqual({ start: '2029-04-01', end: '2029-06-30' });
  });

  it('a contract without renewal ends with its term, then is expired', () => {
    expect(contractSchedule({ start_date: '2024-04-01', duration_months: 36, notice_period_months: 3, auto_renewal: false }, TODAY)!.state)
      .toEqual({ kind: 'ends', end: '2027-03-31', days: 170 });
    const expired = contractSchedule({ start_date: '2025-06-01', duration_months: 12, notice_period_months: 1, auto_renewal: false }, TODAY)!;
    expect(expired.state).toEqual({ kind: 'expired', end: '2026-05-31' });
    expect(expired.lastTerm).toBe(true);
    expect(expired.timeline!.segments.map((s) => s.kind)).toEqual(['past']);
    expect(expired.timeline!.to >= TODAY).toBe(true);
  });

  it('an end of validity stops the renewals after its term', () => {
    const schedule = contractSchedule({
      start_date: '2023-07-01', duration_months: 12, notice_period_months: 6, auto_renewal: true, disabled_at: '2027-03-01T22:59:00.000Z',
    }, TODAY)!;
    expect(schedule.state).toEqual({ kind: 'ends', end: '2027-06-30', days: 261 });
    expect(schedule.timeline!.segments.some((s) => s.kind === 'projected')).toBe(false);
  });

  it('a contract that has not started shows its first term ahead', () => {
    const schedule = contractSchedule({ start_date: '2027-01-01', duration_months: 12, notice_period_months: 2, auto_renewal: true }, TODAY)!;
    expect(schedule.upcoming).toBe(true);
    expect(schedule.timeline!.segments.map((s) => s.kind)).toEqual(['upcoming', 'projected']);
    expect(schedule.timeline!.from <= TODAY).toBe(true);
    expect(schedule.state).toMatchObject({ kind: 'cancel', deadline: '2027-10-31' });
  });

  it('keeps the last days of short months', () => {
    const schedule = contractSchedule({ start_date: '2024-03-01', duration_months: 12, notice_period_months: 1, auto_renewal: true }, TODAY)!;
    expect(schedule.termEnd).toBe('2027-02-28');
    expect(schedule.state).toMatchObject({ kind: 'cancel', deadline: '2027-01-28' });
  });

  it('has no timeline without a duration, and nothing without a start date', () => {
    expect(contractSchedule({ start_date: '2026-01-01', duration_months: 0, auto_renewal: true }, TODAY)).toMatchObject({ state: { kind: 'none' }, timeline: null });
    expect(contractSchedule({ start_date: '' }, TODAY)).toBeNull();
  });
});
