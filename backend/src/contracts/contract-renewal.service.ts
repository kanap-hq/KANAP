import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { DataSource, EntityManager, Raw } from 'typeorm';
import { validate as isUuid } from 'uuid';
import { AuditService } from '../audit/audit.service';
import { ScheduledTasksService } from '../admin/scheduled-tasks/scheduled-tasks.service';
import { StripeConfigService } from '../billing/stripe/stripe.config';
import { Subscription } from '../billing/subscription.entity';
import { evaluateSubscriptionAccess } from '../billing/subscription-freeze.util';
import { deriveStatusFromDisabledAt, endOfValidityFromDate } from '../common/status';
import { withTenant } from '../common/tenant-runner';
import { resolveEmailLocale } from '../i18n/email-i18n';
import { utcDateYmd } from '../notifications/expiry-reminder-schedule';
import { TaskActivitiesService } from '../tasks/task-activities.service';
import { TasksUnifiedService } from '../tasks/tasks-unified.service';
import type { TaskStatus } from '../tasks/task.entity';
import { Contract } from './contract.entity';
import { listContractApplications } from './contract-relations';
import {
  checkEndDate,
  daysBetween,
  proposedEndDate,
  renewalEnd,
  renewalSourceRef,
  renewalTerms,
  renewalTaskText,
  resolveRenewalState,
  resumeRenewalComment,
  stopRenewalComment,
  type RenewalAction,
  type RenewalDecisionRecord,
  type RenewalMode,
  type RenewalState,
  type RenewalTerm,
} from './contract-renewal';
import { readDecisionWindowDays } from './contract-settings.service';
import { addDaysYmd, computeContractTerms, contractCommitment, contractTermsSql } from './contract-terms';

export const CONTRACT_RENEWAL_TASK_NAME = 'contract-renewal-tasks';

/** The longest justification kept; longer text is cut. */
const REASON_MAX_LENGTH = 2000;

type AuditRow = { after_json: any; user_id: string | null; created_at: Date | string };

export type TerminationImpact = {
  currency: string;
  /** The commitment of the year the term ends and of the next one, before and after (contract currency). */
  commitments: Array<{ year: number; before: number; after: number }>;
  /** Applications linked to the contract. */
  applications: Array<{ id: string; name: string }>;
  /** Assets whose support contract it is (`asset_support_info.support_contract_id`). */
  assets: Array<{ id: string; name: string }>;
};

/** `GET /contracts/:id/renewal`: what the renewal decision box shows. */
export type ContractRenewalView = {
  decision_window_days: number;
  /** The end a termination proposes (`proposedEndDate`), null without a duration. */
  proposed_end_date: string | null;
  notice_period_months: number;
  state: 'none' | 'pending' | 'decided';
  /** `renewal`: renew, terminate or renegotiate (tacit renewal on); `end`: renew or let it end (renewal off). */
  mode: RenewalMode | null;
  renegotiating: boolean;
  term: (RenewalTerm & { days_left: number }) | null;
  duration_months: number;
  /** `end_date`: the end chosen by a termination (null on older rows: the term's last day). */
  decision: { decision: RenewalAction; reason: string | null; decided_at: string; decided_by_name: string | null; end_date: string | null } | null;
  can_undo: boolean;
  task: { id: string; item_number: number | null; status: string; assignee_name: string | null } | null;
  /** What a termination changes: while a renewal decision is awaited (ending on the proposed date), or for the `end_date` asked. */
  impact: TerminationImpact | null;
};

export type RenewalRunSummary = { tenantsProcessed: number; created: number; withoutOwner: number; errors: string[] };

/** What the daily run did for one tenant. */
export type TenantRenewalRun = {
  created: Array<{ contract_id: string; contract_name: string; task_id: string; deadline: string }>;
  /** Contracts awaiting a decision with no enabled owner: no task. */
  withoutOwner: Array<{ contract_id: string; contract_name: string }>;
};

type Opts = { manager?: EntityManager };

/**
 * The latest decision recorded for each term of each contract of `contractIds` (session tenant),
 * by the term's last day. One query for the batch. `contractTermFields` takes one contract's as
 * `renewalDecision` (`renewalDecisionOf`); `renewalDecisionSql` reads the same rows.
 */
export async function readRenewalDecisions(mg: EntityManager, contractIds: string[]): Promise<Map<string, Map<string, string>>> {
  const byContract = new Map<string, Map<string, string>>();
  if (contractIds.length === 0) return byContract;
  const rows: Array<{ contract_id: string; source_ref: string; decision: string | null }> = await mg.query(
    `SELECT DISTINCT ON (record_id, source_ref) record_id::text AS contract_id, source_ref,
            after_json->'renewal_decision'->>'decision' AS decision
       FROM audit_log
      WHERE tenant_id = app_current_tenant() AND table_name = 'contracts' AND record_id = ANY($1::uuid[])
        AND source_ref LIKE 'contract-renewal:%' AND after_json ? 'renewal_decision'
      ORDER BY record_id, source_ref, created_at DESC, id DESC`,
    [contractIds],
  );
  for (const row of rows) {
    if (!row.decision) continue;
    const terms = byContract.get(row.contract_id) ?? new Map<string, string>();
    terms.set(row.source_ref.slice('contract-renewal:'.length), row.decision);
    byContract.set(row.contract_id, terms);
  }
  return byContract;
}

/** `renewalDecision` of `contractTermFields` for one contract, from `readRenewalDecisions`. */
export function renewalDecisionOf(decisions: Map<string, Map<string, string>>, contractId: string): (termEnd: string) => string | null {
  const terms = decisions.get(contractId);
  return (termEnd: string) => terms?.get(termEnd) ?? null;
}

/**
 * The renewal decision of a contract (plan contracts-revamp §7, rule in `contract-renewal.ts`):
 * the daily run that creates the decision task, the state the contract page shows and the four
 * actions (renew, terminate, renegotiate, undo). Each action is one request: the contract row is
 * locked first, then the contract, the task, its comment and the audit rows are written in the
 * request's transaction.
 */
@Injectable()
export class ContractRenewalService implements OnModuleInit {
  private readonly logger = new Logger(ContractRenewalService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly tasks: TasksUnifiedService,
    private readonly activities: TaskActivitiesService,
    @Optional() private readonly scheduledTasks?: ScheduledTasksService,
    @Optional() private readonly stripeConfig?: StripeConfigService,
  ) {}

  onModuleInit() {
    this.scheduledTasks?.register({
      name: CONTRACT_RENEWAL_TASK_NAME,
      description: 'Creates a renewal decision task for the owner of each contract whose cancellation deadline enters the decision window',
      defaultCron: '30 7 * * *',
      handler: () => this.run(),
    });
  }

  // ----- Reading -----

  /** The contract of the session tenant, its row locked first when `lock` is set; 404 otherwise. */
  private async findContract(mg: EntityManager, id: string, lock = false): Promise<Contract> {
    if (!isUuid(String(id ?? ''))) throw new NotFoundException('Contract not found');
    if (lock) {
      await mg.query(`SELECT id FROM contracts WHERE tenant_id = app_current_tenant() AND id = $1 FOR NO KEY UPDATE`, [id]);
    }
    const found = await mg.getRepository(Contract).findOne({ where: { id, tenant_id: Raw((alias) => `${alias} = app_current_tenant()`) } });
    if (!found) throw new NotFoundException('Contract not found');
    return found;
  }

  /** The contract's renewal audit rows for the terms ending on `termEnds`, latest first. */
  private async auditRows(mg: EntityManager, contract: Contract, termEnds: string[]): Promise<Map<string, AuditRow[]>> {
    const refs = Array.from(new Set(termEnds)).map(renewalSourceRef);
    const rows: Array<AuditRow & { source_ref: string }> = refs.length
      ? await mg.query(
          `SELECT after_json, user_id, created_at, source_ref FROM audit_log
            WHERE tenant_id = $1 AND table_name = 'contracts' AND record_id = $2 AND source_ref = ANY($3::text[])
            ORDER BY created_at DESC, id DESC`,
          [contract.tenant_id, contract.id, refs],
        )
      : [];
    const byRef = new Map<string, AuditRow[]>();
    for (const row of rows) byRef.set(row.source_ref, [...(byRef.get(row.source_ref) ?? []), row]);
    return byRef;
  }

  private static latestDecision(rows: AuditRow[] | undefined): RenewalDecisionRecord | null {
    const row = (rows ?? []).find((r) => r.after_json?.renewal_decision);
    if (!row) return null;
    const d = row.after_json.renewal_decision;
    return {
      decision: d.decision,
      reason: d.reason ?? null,
      term_end: d.term_end,
      deadline: d.deadline,
      task_id: d.task_id ?? null,
      previous_disabled_at: d.previous_disabled_at ?? null,
      end_date: d.end_date ?? null,
      previous_auto_renewal: typeof d.previous_auto_renewal === 'boolean' ? d.previous_auto_renewal : null,
      decided_at: new Date(row.created_at).toISOString(),
      user_id: row.user_id,
    };
  }

  private static taskId(rows: AuditRow[] | undefined): string | null {
    const row = (rows ?? []).find((r) => r.after_json?.renewal_task?.task_id);
    return row ? String(row.after_json.renewal_task.task_id) : null;
  }

  private async loadState(mg: EntityManager, contract: Contract, today: string, windowDays: number): Promise<{ state: RenewalState; taskId: string | null }> {
    // The decision may be about the term of the next deadline, the current one or the contract's end: read the keys.
    const terms = renewalTerms(contract, today);
    const end = contract.auto_renewal ? null : renewalEnd(contract, today);
    const keys = terms ? [terms.pending.term_end, ...(terms.current ? [terms.current.term_end] : []), ...(end ? [end.term_end] : [])] : [];
    const rows = await this.auditRows(mg, contract, keys);
    const state = resolveRenewalState(contract, today, windowDays, (termEnd) => ContractRenewalService.latestDecision(rows.get(renewalSourceRef(termEnd))));
    const taskId = state.kind === 'none' ? null : ContractRenewalService.taskId(rows.get(renewalSourceRef(state.term.term_end)));
    return { state, taskId };
  }

  /** What ending the contract on `endDate` changes. */
  private async terminationImpact(mg: EntityManager, contract: Contract, endDate: string): Promise<TerminationImpact> {
    const ended = { ...contract, disabled_at: endOfValidityFromDate(endDate) };
    const firstYear = Number(endDate.slice(0, 4));
    const commitments = [firstYear, firstYear + 1]
      .map((year) => ({ year, before: contractCommitment(contract, year), after: contractCommitment(ended, year) }))
      .filter((row) => row.before !== row.after);
    const { items: applications } = await listContractApplications(mg, contract);
    const assets: Array<{ id: string; name: string }> = await mg.query(
      `SELECT a.id, a.name
         FROM asset_support_info s
         JOIN assets a ON a.tenant_id = s.tenant_id AND a.id = s.asset_id
        WHERE s.tenant_id = $1 AND s.support_contract_id = $2
        ORDER BY a.name ASC, a.id ASC`,
      [contract.tenant_id, contract.id],
    );
    return { currency: (contract.currency || 'EUR').toUpperCase(), commitments, applications, assets };
  }

  private async view(mg: EntityManager, contract: Contract, today: string, windowDays: number, impactEndDate?: string): Promise<ContractRenewalView> {
    const { state, taskId } = await this.loadState(mg, contract, today, windowDays);
    const base: ContractRenewalView = {
      decision_window_days: windowDays,
      proposed_end_date: proposedEndDate(contract, today),
      notice_period_months: Math.max(0, Math.trunc(Number(contract.notice_period_months ?? 0)) || 0),
      state: state.kind,
      mode: state.kind === 'none' ? null : state.mode,
      renegotiating: false,
      term: null,
      duration_months: Number(contract.duration_months ?? 0),
      decision: null,
      can_undo: false,
      task: null,
      impact: impactEndDate ? await this.terminationImpact(mg, contract, impactEndDate) : null,
    };
    if (state.kind === 'none') return base;
    const [task] = taskId
      ? await mg.query(
          `SELECT t.id, t.item_number, t.status, NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), '') AS assignee_name
             FROM tasks t
             LEFT JOIN users u ON u.tenant_id = t.tenant_id AND u.id = t.assignee_user_id
            WHERE t.tenant_id = $1 AND t.id = $2`,
          [contract.tenant_id, taskId],
        )
      : [];
    const record = state.record;
    const [author] = record?.user_id
      ? await mg.query(
          `SELECT NULLIF(btrim(concat_ws(' ', first_name, last_name)), '') AS name FROM users WHERE tenant_id = $1 AND id = $2`,
          [contract.tenant_id, record.user_id],
        )
      : [];
    return {
      ...base,
      renegotiating: state.kind === 'pending' && state.renegotiating,
      term: { ...state.term, days_left: daysBetween(today, state.term.deadline) },
      decision: record
        ? { decision: record.decision, reason: record.reason, decided_at: record.decided_at, decided_by_name: author?.name ?? null, end_date: record.end_date ?? null }
        : null,
      can_undo: state.kind === 'decided' && state.can_undo,
      task: task ? { id: task.id, item_number: task.item_number == null ? null : Number(task.item_number), status: task.status, assignee_name: task.assignee_name } : null,
      impact: impactEndDate
        ? base.impact
        : state.kind === 'pending' && state.mode === 'renewal' ? await this.terminationImpact(mg, contract, state.term.term_end) : null,
    };
  }

  /**
   * The renewal state of a contract of the session tenant. With `endDate` (`?end_date=`), `impact`
   * says what ending the contract on that day changes, whatever the state (the date checked as
   * for an action, 400 otherwise).
   */
  async get(id: string, opts?: Opts & { endDate?: unknown }): Promise<ContractRenewalView> {
    const mg = opts?.manager ?? this.dataSource.manager;
    const contract = await this.findContract(mg, id);
    const windowDays = await readDecisionWindowDays(mg, contract.tenant_id);
    const today = utcDateYmd(new Date());
    const asked = opts?.endDate == null || opts.endDate === '' ? undefined : ContractRenewalService.endDateOf(opts.endDate, contract, today);
    return this.view(mg, contract, today, windowDays, asked);
  }

  /** The end of a termination: the one asked (checked, 400 otherwise) or the proposed one. */
  private static endDateOf(raw: unknown, contract: Contract, today: string): string {
    if (raw == null || raw === '') {
      const proposed = proposedEndDate(contract, today);
      if (!proposed) throw new BadRequestException('end_date is required for a contract without a duration.');
      return proposed;
    }
    const check = checkEndDate(raw, contract, today);
    if (!check.ok) throw new BadRequestException(check.message);
    return check.date;
  }

  // ----- Actions -----

  /**
   * One action on the renewal decision, `userId` the person deciding. With tacit renewal on
   * (`renewal` mode), `renew`, `terminate` and `renegotiate` need a decision awaited; without it
   * (`end` mode, lot CR2 round 2), `renew` and `end`. 409 otherwise. `undo` needs an undoable
   * decision and puts back what it changed.
   */
  async act(id: string, action: RenewalAction, body: { reason?: unknown; end_date?: unknown } | null | undefined, userId: string | null, opts?: Opts): Promise<ContractRenewalView> {
    const mg = opts?.manager ?? this.dataSource.manager;
    const contract = await this.findContract(mg, id, true);
    const tenantId = contract.tenant_id;
    const windowDays = await readDecisionWindowDays(mg, tenantId);
    const today = utcDateYmd(new Date());
    const { state, taskId } = await this.loadState(mg, contract, today, windowDays);
    const reason = normalizeReason(body?.reason);

    if (action === 'undo') {
      if (state.kind !== 'decided' || !state.can_undo) throw new ConflictException('There is no decision to undo for this contract.');
      const record = state.record;
      // A termination, or a renewal decided on an end, changed the contract: both values go back.
      const restores = record.decision === 'terminate' || (record.decision === 'renew' && record.previous_auto_renewal === false);
      const after = restores
        ? await this.writeRenewal(
            mg,
            contract,
            record.previous_auto_renewal ?? contract.auto_renewal,
            record.previous_disabled_at ? new Date(record.previous_disabled_at) : null,
          )
        : contract;
      await this.logDecision(mg, contract, after, ContractRenewalService.recordTerm(state.term, record), { decision: 'undo', reason, task_id: taskId }, userId);
      if (taskId) await this.updateTask(mg, taskId, tenantId, userId, { status: 'open', reason, reopen: true });
      return this.view(mg, after, today, windowDays);
    }

    if (state.kind !== 'pending') throw new ConflictException('No renewal decision is awaited for this contract.');
    const term = state.term;
    const allowed: RenewalAction[] = state.mode === 'end' ? ['renew', 'end'] : ['renew', 'terminate', 'renegotiate'];
    if (!allowed.includes(action)) throw new ConflictException('This decision does not apply to this contract.');
    const previousDisabledAt = contract.disabled_at ? new Date(contract.disabled_at).toISOString() : null;

    if (action === 'terminate') {
      // The renewal turns off and the contract ends on the day chosen; the term rule keeps its past terms.
      const endDate = ContractRenewalService.endDateOf(body?.end_date, contract, today);
      const after = await this.writeRenewal(mg, contract, false, endOfValidityFromDate(endDate));
      // Keyed by the term that contains the end, where the contract, now without renewal, looks for it.
      const endTerm = renewalEnd(after, today) ?? term;
      await this.logDecision(mg, contract, after, { ...endTerm, deadline: term.deadline }, {
        decision: 'terminate', reason, task_id: taskId, previous_disabled_at: previousDisabledAt, previous_auto_renewal: Boolean(contract.auto_renewal), end_date: endDate,
      }, userId);
      if (taskId) await this.updateTask(mg, taskId, tenantId, userId, { status: 'done', reason });
      return this.view(mg, after, today, windowDays);
    }
    if (action === 'renew' && state.mode === 'end') {
      // The renewal turns on and the end of validity goes: the contract renews at the end of its term.
      const after = await this.writeRenewal(mg, contract, true, null);
      await this.logDecision(mg, contract, after, term, {
        decision: 'renew', reason, task_id: taskId, previous_disabled_at: previousDisabledAt, previous_auto_renewal: false, end_date: term.end_date,
      }, userId);
      if (taskId) await this.updateTask(mg, taskId, tenantId, userId, { status: 'done', reason });
      return this.view(mg, after, today, windowDays);
    }
    await this.logDecision(mg, contract, contract, term, {
      decision: action, reason, task_id: taskId, ...(action === 'end' ? { end_date: term.end_date } : {}),
    }, userId);
    if (taskId) {
      await this.updateTask(mg, taskId, tenantId, userId, action === 'renegotiate' ? { reason } : { status: 'done', reason });
    }
    return this.view(mg, contract, today, windowDays);
  }

  /** The term an undoing is recorded on: the one the decision was keyed by. */
  private static recordTerm(term: RenewalTerm, record: RenewalDecisionRecord): RenewalTerm {
    return { ...term, term_end: record.term_end || term.term_end, deadline: record.deadline || term.deadline };
  }

  /**
   * Turns off the tacit renewal of a contract from its properties (lot CR2, round 2): renewal off
   * and the end of validity on `end_date` (`YYYY-MM-DD`, today or later, not before the start; by
   * default the proposed end, `proposedEndDate`). The term rule keeps the terms it has run. No
   * decision is recorded: the contract now awaits one on its end (`end` mode). The decision task
   * open for it is adapted (title "Decide whether to renew or let … end", due on the end, a comment
   * saying why); without one, a task is created when the end falls within the window, keyed as the
   * daily run keys it. One audit row (`renewal_stop.end_date`). 409 when the renewal is already off,
   * or when the contract is in its first term with no decision awaited (the renewal field turns it
   * off directly there).
   */
  async stopRenewal(id: string, body: { end_date?: unknown } | null | undefined, userId: string | null, opts?: Opts): Promise<ContractRenewalView> {
    const mg = opts?.manager ?? this.dataSource.manager;
    const contract = await this.findContract(mg, id, true);
    const tenantId = contract.tenant_id;
    const windowDays = await readDecisionWindowDays(mg, tenantId);
    const today = utcDateYmd(new Date());
    if (!contract.auto_renewal) throw new ConflictException('The tacit renewal of this contract is already off.');
    const { state, taskId } = await this.loadState(mg, contract, today, windowDays);
    if (state.kind !== 'pending' && computeContractTerms(contract, today).term_index === 0) {
      throw new ConflictException('This contract has not been renewed yet: turn off its tacit renewal instead.');
    }
    const endDate = ContractRenewalService.endDateOf(body?.end_date, contract, today);
    const after = await this.writeRenewal(mg, contract, false, endOfValidityFromDate(endDate));
    await this.audit.log({
      table: 'contracts', recordId: contract.id, action: 'update', before: contract,
      after: { ...after, renewal_stop: { end_date: endDate } }, userId,
    }, { manager: mg });

    // The decision task follows: the one open for the contract, or a new one within the window.
    const end = renewalEnd(after, today);
    if (end) {
      const endRows = await this.auditRows(mg, after, [end.term_end]);
      const endTaskId = ContractRenewalService.taskId(endRows.get(renewalSourceRef(end.term_end)));
      const openTaskId = (await this.openTask(mg, tenantId, taskId)) ?? (await this.openTask(mg, tenantId, endTaskId));
      if (openTaskId) {
        const [user]: Array<{ locale: string | null }> = userId
          ? await mg.query(`SELECT locale FROM users WHERE tenant_id = $1 AND id = $2`, [tenantId, userId])
          : [];
        const language = resolveEmailLocale(user?.locale ?? null);
        const [assignee]: Array<{ locale: string | null }> = await mg.query(
          `SELECT u.locale FROM tasks t JOIN users u ON u.tenant_id = t.tenant_id AND u.id = t.assignee_user_id WHERE t.tenant_id = $1 AND t.id = $2`,
          [tenantId, openTaskId],
        );
        const text = renewalTaskText(resolveEmailLocale(assignee?.locale ?? user?.locale ?? null), after.name, end, 'end');
        await this.tasks.updateForTarget(
          { type: 'contract', id: after.id, payload: { id: openTaskId, title: text.title, due_date: end.deadline } as any },
          userId ?? undefined,
          { manager: mg, tenantId },
        );
        await this.updateTask(mg, openTaskId, tenantId, userId, { reason: stopRenewalComment(language, endDate) });
        if (endTaskId !== openTaskId) await this.logTaskRow(mg, after, end, openTaskId, null);
      } else if (!endTaskId && end.deadline <= addDaysYmd(today, windowDays)) {
        await this.createDecisionTask(mg, after, end, 'end');
      }
    }
    return this.view(mg, after, today, windowDays);
  }

  /**
   * Turns the tacit renewal back on from the contract's properties (lot CR2, round 3): on a contract
   * without renewal that has an end of validity (set by turning the renewal off, or by hand), the
   * renewal goes on and the end of validity goes, in one write. While a decision is awaited on its
   * end (`end` mode), this is that decision's "renew" (decision recorded, task closed, undoable).
   * Otherwise one audit row (`renewal_resume.previous_end_date`), and the decision task still open
   * on its end follows the renewal: it becomes the renewal decision's task (title, due on the
   * cancellation deadline) when that deadline is within the window, and is closed otherwise, each
   * time with a comment saying why. 409 when the renewal is already on, or without an end of
   * validity (the renewal field turns it on directly there).
   */
  async resumeRenewal(id: string, userId: string | null, opts?: Opts): Promise<ContractRenewalView> {
    const mg = opts?.manager ?? this.dataSource.manager;
    const contract = await this.findContract(mg, id, true);
    const tenantId = contract.tenant_id;
    if (contract.auto_renewal) throw new ConflictException('The tacit renewal of this contract is already on.');
    if (!contract.disabled_at) throw new ConflictException('This contract has no end of validity: turn its tacit renewal on instead.');
    const windowDays = await readDecisionWindowDays(mg, tenantId);
    const today = utcDateYmd(new Date());
    const { state } = await this.loadState(mg, contract, today, windowDays);
    if (state.kind === 'pending' && state.mode === 'end') return this.act(id, 'renew', {}, userId, opts);

    const previousEnd = new Date(contract.disabled_at).toISOString().slice(0, 10);
    // The end task, read before the write (its key is the term that contains the end).
    const end = renewalEnd(contract, today);
    const endRows = end ? await this.auditRows(mg, contract, [end.term_end]) : new Map<string, AuditRow[]>();
    const endTaskId = end ? await this.openTask(mg, tenantId, ContractRenewalService.taskId(endRows.get(renewalSourceRef(end.term_end)))) : null;

    const after = await this.writeRenewal(mg, contract, true, null);
    await this.audit.log({
      table: 'contracts', recordId: contract.id, action: 'update', before: contract,
      after: { ...after, renewal_resume: { previous_end_date: previousEnd } }, userId,
    }, { manager: mg });

    if (endTaskId) {
      const [user]: Array<{ locale: string | null }> = userId
        ? await mg.query(`SELECT locale FROM users WHERE tenant_id = $1 AND id = $2`, [tenantId, userId])
        : [];
      const reason = resumeRenewalComment(resolveEmailLocale(user?.locale ?? null), previousEnd);
      const { state: next, taskId: nextTaskId } = await this.loadState(mg, after, today, windowDays);
      if (next.kind === 'pending' && next.mode === 'renewal' && (!nextTaskId || nextTaskId === endTaskId)) {
        // The renewal decision is due: the task becomes its task.
        const [assignee]: Array<{ locale: string | null }> = await mg.query(
          `SELECT u.locale FROM tasks t JOIN users u ON u.tenant_id = t.tenant_id AND u.id = t.assignee_user_id WHERE t.tenant_id = $1 AND t.id = $2`,
          [tenantId, endTaskId],
        );
        const text = renewalTaskText(resolveEmailLocale(assignee?.locale ?? user?.locale ?? null), after.name, next.term, 'renewal');
        await this.tasks.updateForTarget(
          { type: 'contract', id: after.id, payload: { id: endTaskId, title: text.title, due_date: next.term.deadline } as any },
          userId ?? undefined,
          { manager: mg, tenantId },
        );
        await this.updateTask(mg, endTaskId, tenantId, userId, { reason });
        if (nextTaskId !== endTaskId) await this.logTaskRow(mg, after, next.term, endTaskId, null);
      } else {
        // No decision due on the renewal yet: nothing left to decide on the end.
        await this.updateTask(mg, endTaskId, tenantId, userId, { status: 'done', reason });
      }
    }
    return this.view(mg, after, today, windowDays);
  }

  /** `taskId` when that task still exists and is not closed. */
  private async openTask(mg: EntityManager, tenantId: string, taskId: string | null): Promise<string | null> {
    if (!taskId) return null;
    const [task]: Array<{ status: TaskStatus }> = await mg.query(`SELECT status FROM tasks WHERE tenant_id = $1 AND id = $2`, [tenantId, taskId]);
    return task && task.status !== 'done' && task.status !== 'cancelled' ? taskId : null;
  }

  /** Sets the contract's tacit renewal and end of validity (its status follows it), as one targeted update. */
  private async writeRenewal(mg: EntityManager, contract: Contract, autoRenewal: boolean, disabledAt: Date | null): Promise<Contract> {
    const status = deriveStatusFromDisabledAt(disabledAt);
    await mg.query(
      `UPDATE contracts SET auto_renewal = $3, disabled_at = $4, status = $5, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [contract.tenant_id, contract.id, autoRenewal, disabledAt, status],
    );
    const [saved] = await mg.getRepository(Contract).find({ where: { id: contract.id, tenant_id: contract.tenant_id }, take: 1 });
    return saved;
  }

  private async logDecision(
    mg: EntityManager,
    before: Contract,
    after: Contract,
    term: RenewalTerm,
    decision: {
      decision: RenewalAction;
      reason: string | null;
      task_id: string | null;
      previous_disabled_at?: string | null;
      previous_auto_renewal?: boolean;
      end_date?: string | null;
    },
    userId: string | null,
  ) {
    await this.audit.log({
      table: 'contracts',
      recordId: before.id,
      action: 'update',
      before,
      after: { ...after, renewal_decision: { ...decision, term_end: term.term_end, deadline: term.deadline } },
      userId,
      sourceRef: renewalSourceRef(term.term_end),
    }, { manager: mg });
  }

  /**
   * The decision task: the justification as a comment, and its status (done for a renewal or a
   * termination, open again on an undo). A task deleted since is skipped; a task already in the
   * status asked for only gets the comment.
   */
  private async updateTask(
    mg: EntityManager,
    taskId: string,
    tenantId: string,
    userId: string | null,
    change: { status?: TaskStatus; reason: string | null; reopen?: boolean },
  ) {
    const [task]: Array<{ status: TaskStatus }> = await mg.query(`SELECT status FROM tasks WHERE tenant_id = $1 AND id = $2`, [tenantId, taskId]);
    if (!task) return;
    let status: TaskStatus | undefined;
    if (change.reopen) status = task.status === 'done' || task.status === 'cancelled' ? 'open' : undefined;
    else if (change.status && task.status !== change.status) status = change.status;
    if (!status && !change.reason) return;
    await this.activities.createUnified(
      taskId,
      { type: 'unified', ...(change.reason ? { content: change.reason } : {}), ...(status ? { status } : {}) },
      tenantId,
      userId,
      { manager: mg },
    );
  }

  // ----- Daily run -----

  /** Every active tenant, one transaction each. A frozen or trial-expired subscription is skipped (cloud only). */
  async run(now: Date = new Date()): Promise<RenewalRunSummary> {
    const summary: RenewalRunSummary = { tenantsProcessed: 0, created: 0, withoutOwner: 0, errors: [] };
    const tenants: Array<{ id: string; slug: string | null }> = await this.dataSource.query(
      `SELECT id, slug FROM tenants WHERE status = 'active' ORDER BY id ASC`,
    );
    for (const tenant of tenants) {
      try {
        const result = await withTenant(this.dataSource, tenant.id, async (tx) => {
          if (await this.subscriptionPaused(tx, tenant.id)) return null;
          return this.runForTenant(tx, tenant.id, now);
        });
        if (!result) continue;
        summary.tenantsProcessed += 1;
        summary.created += result.created.length;
        summary.withoutOwner += result.withoutOwner.length;
      } catch (error: any) {
        summary.errors.push(`Tenant ${tenant.slug ?? tenant.id}: ${error?.message || String(error)}`);
      }
    }
    const line = `[${CONTRACT_RENEWAL_TASK_NAME}] ${summary.created} task(s) created, ${summary.withoutOwner} contract(s) without an owner`
      + (summary.errors.length ? `; ${summary.errors.length} failure(s): ${summary.errors.join(' | ')}` : '');
    if (summary.errors.length) this.logger.warn(line);
    else if (summary.created > 0 || summary.withoutOwner > 0) this.logger.log(line);
    if (summary.errors.length > 0 && summary.tenantsProcessed === 0 && tenants.length > 0) {
      throw new Error(`All tenants failed: ${summary.errors[0]}`);
    }
    return summary;
  }

  /** Background writes stop for a frozen or trial-expired subscription, as Netbox's (no-op on-premise). */
  private async subscriptionPaused(mg: EntityManager, tenantId: string): Promise<boolean> {
    if (!this.stripeConfig?.isConfigured()) return false;
    const subscription = await mg.getRepository(Subscription).findOne({ where: { tenant_id: tenantId }, order: { created_at: 'DESC' } });
    return !evaluateSubscriptionAccess(subscription, Date.now(), true).allowed;
  }

  /**
   * One tenant, `mg` scoped to it: a task for each contract awaiting a decision (the "to decide"
   * state with the tenant's window) that has none for that term yet. The contract row is locked
   * before its audit rows are read, so two runs never create two tasks. A contract without an
   * enabled owner gets none (counted in `withoutOwner`); it gets one on a later run once it has
   * an owner, while its deadline has not passed.
   */
  async runForTenant(mg: EntityManager, tenantId: string, now: Date = new Date()): Promise<TenantRenewalRun> {
    const today = utcDateYmd(now);
    const windowDays = await readDecisionWindowDays(mg, tenantId);
    const terms = contractTermsSql('c', '$2::date', { decisionWindowDays: windowDays });
    const candidates: Array<{ id: string }> = await mg.query(
      `SELECT c.id FROM contracts c
        WHERE c.tenant_id = $1
          AND (c.disabled_at IS NULL OR c.disabled_at > now())
          AND ${terms.termState} = 'to_decide'
        ORDER BY c.name ASC, c.id ASC`,
      [tenantId, today],
    );
    const result: TenantRenewalRun = { created: [], withoutOwner: [] };
    for (const { id } of candidates) {
      const contract = await this.findContract(mg, id, true);
      const { state, taskId } = await this.loadState(mg, contract, today, windowDays);
      if (state.kind !== 'pending' || taskId) continue;
      const task = await this.createDecisionTask(mg, contract, state.term, state.mode);
      if (!task) {
        result.withoutOwner.push({ contract_id: contract.id, contract_name: contract.name });
        continue;
      }
      result.created.push({ contract_id: contract.id, contract_name: contract.name, task_id: task.id, deadline: state.term.deadline });
    }
    return result;
  }

  /**
   * The decision task of a term (`renewal` mode) or an end (`end` mode), assigned to the enabled
   * owner in their language, due on the deadline (the end for an end), with its `renewal_task`
   * row under the term's key. Null without an enabled owner.
   */
  private async createDecisionTask(mg: EntityManager, contract: Contract, term: RenewalTerm, mode: RenewalMode): Promise<{ id: string } | null> {
    const tenantId = contract.tenant_id;
    const [owner]: Array<{ id: string; locale: string | null }> = contract.owner_user_id
      ? await mg.query(`SELECT id, locale FROM users WHERE tenant_id = $1 AND id = $2 AND status = 'enabled'`, [tenantId, contract.owner_user_id])
      : [];
    if (!owner) return null;
    const text = renewalTaskText(resolveEmailLocale(owner.locale), contract.name, term, mode);
    const task = await this.tasks.createForTarget(
      {
        type: 'contract',
        id: contract.id,
        payload: { title: text.title, description: text.description, due_date: term.deadline, assignee_user_id: owner.id, status: 'open' },
      },
      undefined,
      { manager: mg, tenantId, audit: { source: 'system', sourceRef: renewalSourceRef(term.term_end) } },
    );
    await this.logTaskRow(mg, contract, term, task.id, task.item_number ?? null);
    return task;
  }

  /** The `renewal_task` row: the decision task of the term, so no run creates another. */
  private async logTaskRow(mg: EntityManager, contract: Contract, term: RenewalTerm, taskId: string, itemNumber: number | null) {
    await this.audit.log({
      table: 'contracts',
      recordId: contract.id,
      action: 'update',
      before: { renewal_task: null },
      after: { renewal_task: { task_id: taskId, item_number: itemNumber, term_end: term.term_end, deadline: term.deadline } },
      userId: null,
      source: 'system',
      sourceRef: renewalSourceRef(term.term_end),
    }, { manager: mg });
  }
}

function normalizeReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, REASON_MAX_LENGTH) : null;
}
