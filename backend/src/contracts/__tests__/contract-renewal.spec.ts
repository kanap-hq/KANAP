import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import {
  renewalSourceRef,
  renewalTaskText,
  renewalTerms,
  resolveRenewalState,
  type RenewalDecisionRecord,
  type RenewalInput,
} from '../contract-renewal';
import { applyContractSettingsPatch, DEFAULT_CONTRACT_SETTINGS, normalizeContractSettings } from '../contract-settings.service';
import { ContractRenewalController } from '../contract-renewal.controller';
import { ContractSettingsController } from '../contract-settings.controller';

// The renewal decision rule (contracts/contract-renewal.ts), the tenant's decision window setting
// and the rights of their routes. Pure: no database.

// A yearly contract from 1 July 2023, 6 months notice: terms end every 30 June, deadlines every
// 30 December (term 4 runs from 1 July 2026 to 30 June 2027, its deadline 2026-12-30).
const SAP: RenewalInput = { start_date: '2023-07-01', duration_months: 12, notice_period_months: 6, auto_renewal: true, disabled_at: null };

const record = (decision: RenewalDecisionRecord['decision'], termEnd: string, extra: Partial<RenewalDecisionRecord> = {}): RenewalDecisionRecord => ({
  decision, reason: null, term_end: termEnd, deadline: '', task_id: null, decided_at: '2026-10-12T10:00:00.000Z', user_id: null, ...extra,
});
const none = () => null;
const only = (termEnd: string, rec: RenewalDecisionRecord) => (key: string) => (key === termEnd ? rec : null);

// ----- The terms a decision is about -----
{
  const terms = renewalTerms(SAP, '2026-10-13')!;
  assert.deepEqual(terms.pending, {
    term_index: 3, term_start: '2026-07-01', term_end: '2027-06-30', deadline: '2026-12-30', renews_on: '2027-07-01', next_term_end: '2028-06-30',
  }, 'the term of the next deadline');
  assert.equal(terms.current, null, 'its own deadline is still ahead: no current term apart');

  const after = renewalTerms(SAP, '2027-01-05')!;
  assert.equal(after.pending.term_end, '2028-06-30', 'past the deadline, the next term is the one to decide');
  assert.equal(after.current?.term_end, '2027-06-30', 'the term in progress keeps its decision until its end');
  assert.equal(renewalTerms({ ...SAP, duration_months: 0 }, '2026-10-13'), null, 'no duration, no term');
  // Notice longer than the term: the deadline of a term falls before it starts.
  const long = renewalTerms({ start_date: '2026-01-01', duration_months: 3, notice_period_months: 5 }, '2026-02-01')!;
  assert.ok(long.pending.deadline >= '2026-02-01', 'the first deadline on or after today');
  assert.equal(renewalSourceRef('2027-06-30'), 'contract-renewal:2027-06-30');
}

// ----- The state -----
{
  const today = '2026-10-13';
  const pending = resolveRenewalState(SAP, today, 90, none);
  assert.equal(pending.kind, 'pending', 'the deadline is 79 days away, within 90');
  assert.equal(resolveRenewalState(SAP, today, 30, none).kind, 'none', 'outside a 30-day window');
  assert.equal(resolveRenewalState(SAP, '2026-12-30', 0, none).kind, 'pending', 'a window of 0 days: the deadline day only');
  assert.equal(resolveRenewalState({ ...SAP, auto_renewal: false }, today, 90, none).kind, 'none', 'no tacit renewal: nothing to decide');
  assert.equal(resolveRenewalState({ ...SAP, disabled_at: '2027-03-01T12:00:00Z' }, today, 90, none).kind, 'none', 'the contract stops before the next term');
  assert.equal(resolveRenewalState({ ...SAP, duration_months: 0 }, today, 90, none).kind, 'none', 'no duration');

  const reneg = resolveRenewalState(SAP, today, 90, only('2027-06-30', record('renegotiate', '2027-06-30')));
  assert.ok(reneg.kind === 'pending' && reneg.renegotiating, 'renegotiation keeps the decision awaited');
  const undone = resolveRenewalState(SAP, today, 90, only('2027-06-30', record('undo', '2027-06-30')));
  assert.ok(undone.kind === 'pending' && !undone.renegotiating && undone.record === null, 'an undone decision awaits again');

  const renewed = resolveRenewalState(SAP, today, 90, only('2027-06-30', record('renew', '2027-06-30')));
  assert.ok(renewed.kind === 'decided' && renewed.can_undo && renewed.record.decision === 'renew', 'a renewal stands until the deadline, undoable');
  assert.equal(
    resolveRenewalState({ ...SAP, auto_renewal: false }, today, 90, only('2027-06-30', record('renew', '2027-06-30'))).kind,
    'none',
    'a renewal no longer stands once the renewal was switched off by hand',
  );

  const ended = { ...SAP, disabled_at: '2027-06-30T12:00:00.000Z' };
  const terminated = resolveRenewalState(ended, today, 90, only('2027-06-30', record('terminate', '2027-06-30')));
  assert.ok(terminated.kind === 'decided' && terminated.can_undo && terminated.record.decision === 'terminate', 'a termination stands: the contract ends with the term');
  assert.equal(
    resolveRenewalState(SAP, today, 90, only('2027-06-30', record('terminate', '2027-06-30'))).kind,
    'pending',
    'a termination whose end of validity was cleared by hand no longer stands',
  );

  // Past the deadline: the decision shows until the term ends, and can no longer be undone.
  const later = resolveRenewalState(ended, '2027-02-01', 90, only('2027-06-30', record('terminate', '2027-06-30')));
  assert.ok(later.kind === 'decided' && !later.can_undo, 'past the deadline: shown, not undoable');
  assert.equal(resolveRenewalState(ended, '2027-07-01', 90, only('2027-06-30', record('terminate', '2027-06-30'))).kind, 'none', 'after the term: nothing');
  const renewedLater = resolveRenewalState(SAP, '2027-02-01', 90, only('2027-06-30', record('renew', '2027-06-30')));
  assert.ok(renewedLater.kind === 'decided' && !renewedLater.can_undo, 'a renewal shows until the term ends');
}

// ----- The task text -----
{
  const term = renewalTerms(SAP, '2026-10-13')!.pending;
  assert.equal(renewalTaskText('fr', 'SAP Maintenance & Support', term).title, 'Décider du renouvellement de SAP Maintenance & Support');
  assert.equal(renewalTaskText('xx', 'SAP', term).title, 'Decide on the renewal of SAP', 'English otherwise');
  assert.match(renewalTaskText('fr', 'SAP', term).description, /30\/12\/2026.*01\/07\/2027/);
}

// ----- The tenant's decision window -----
{
  assert.deepEqual(normalizeContractSettings(undefined), DEFAULT_CONTRACT_SETTINGS);
  assert.equal(DEFAULT_CONTRACT_SETTINGS.decision_window_days, 90, 'default 90 days');
  assert.deepEqual(normalizeContractSettings({ decision_window_days: 400 }), DEFAULT_CONTRACT_SETTINGS, 'an out-of-range stored value reads as the default');
  assert.deepEqual(normalizeContractSettings({ decision_window_days: 45 }), { decision_window_days: 45 });
  assert.deepEqual(applyContractSettingsPatch(DEFAULT_CONTRACT_SETTINGS, { decision_window_days: 0 }), { decision_window_days: 0 }, 'lower bound');
  assert.deepEqual(applyContractSettingsPatch(DEFAULT_CONTRACT_SETTINGS, { decision_window_days: 365 }), { decision_window_days: 365 }, 'upper bound');
  assert.deepEqual(applyContractSettingsPatch(DEFAULT_CONTRACT_SETTINGS, { other: 1 }), DEFAULT_CONTRACT_SETTINGS, 'unknown fields ignored');
  for (const bad of [-1, 366, 1.5, '30', null]) {
    assert.throws(() => applyContractSettingsPatch(DEFAULT_CONTRACT_SETTINGS, { decision_window_days: bad }), BadRequestException, `refused: ${String(bad)}`);
  }
}

// ----- Rights -----
{
  const level = (proto: any, route: string) => Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto[route]);
  assert.deepEqual(level(ContractRenewalController.prototype, 'get'), { resource: 'contracts', level: 'reader' }, 'renewal state: contract readers');
  for (const route of ['renew', 'terminate', 'renegotiate', 'undo']) {
    assert.deepEqual(level(ContractRenewalController.prototype, route), { resource: 'contracts', level: 'member' }, `${route}: contract editors`);
  }
  assert.deepEqual(level(ContractSettingsController.prototype, 'get'), { resource: 'contracts', level: 'reader' }, 'settings read');
  assert.deepEqual(level(ContractSettingsController.prototype, 'update'), { resource: 'contracts', level: 'admin' }, 'settings write: contract admins');
}

console.log('contract-renewal.spec: ok');
