import { ConflictException, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
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
  daysBetween,
  renewalSourceRef,
  renewalTerms,
  renewalTaskText,
  resolveRenewalState,
  type RenewalAction,
  type RenewalDecisionRecord,
  type RenewalState,
  type RenewalTerm,
} from './contract-renewal';
import { readDecisionWindowDays } from './contract-settings.service';
import { computeContractTerms, contractCommitment, contractTermsSql } from './contract-terms';

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
  state: 'none' | 'pending' | 'decided';
  renegotiating: boolean;
  term: (RenewalTerm & { days_left: number }) | null;
  duration_months: number;
  decision: { decision: RenewalAction; reason: string | null; decided_at: string; decided_by_name: string | null } | null;
  can_undo: boolean;
  task: { id: string; item_number: number | null; status: string; assignee_name: string | null } | null;
  /** While a decision is awaited: what a termination changes. */
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
 * The terms with a confirmed renewal of each contract of `contractIds` (session tenant), by the
 * term's last day: the latest decision recorded for the term is a renewal. One query for the batch.
 * `contractTermFields` takes it as `renewalConfirmed`; `renewalConfirmedSql` reads the same rows.
 */
export async function readConfirmedRenewals(mg: EntityManager, contractIds: string[]): Promise<Map<string, Set<string>>> {
  const byContract = new Map<string, Set<string>>();
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
    if (row.decision !== 'renew') continue;
    const termEnd = row.source_ref.slice('contract-renewal:'.length);
    const set = byContract.get(row.contract_id) ?? new Set<string>();
    set.add(termEnd);
    byContract.set(row.contract_id, set);
  }
  return byContract;
}

/** `renewalConfirmed` of `contractTermFields` for one contract, from `readConfirmedRenewals`. */
export function confirmedRenewalOf(confirmed: Map<string, Set<string>>, contractId: string): (termEnd: string) => boolean {
  const terms = confirmed.get(contractId);
  return (termEnd: string) => terms?.has(termEnd) ?? false;
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
      decided_at: new Date(row.created_at).toISOString(),
      user_id: row.user_id,
    };
  }

  private static taskId(rows: AuditRow[] | undefined): string | null {
    const row = (rows ?? []).find((r) => r.after_json?.renewal_task?.task_id);
    return row ? String(row.after_json.renewal_task.task_id) : null;
  }

  private async loadState(mg: EntityManager, contract: Contract, today: string, windowDays: number): Promise<{ state: RenewalState; taskId: string | null }> {
    // The decision may be about the term of the next deadline or the current one: read both keys.
    const terms = renewalTerms(contract, today);
    const keys = terms ? [terms.pending.term_end, ...(terms.current ? [terms.current.term_end] : [])] : [];
    const rows = await this.auditRows(mg, contract, keys);
    const state = resolveRenewalState(contract, today, windowDays, (termEnd) => ContractRenewalService.latestDecision(rows.get(renewalSourceRef(termEnd))));
    const taskId = state.kind === 'none' ? null : ContractRenewalService.taskId(rows.get(renewalSourceRef(state.term.term_end)));
    return { state, taskId };
  }

  private async terminationImpact(mg: EntityManager, contract: Contract, term: RenewalTerm): Promise<TerminationImpact> {
    const ended = { ...contract, disabled_at: endOfValidityFromDate(term.term_end) };
    const firstYear = Number(term.term_end.slice(0, 4));
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

  private async view(mg: EntityManager, contract: Contract, today: string, windowDays: number): Promise<ContractRenewalView> {
    const { state, taskId } = await this.loadState(mg, contract, today, windowDays);
    const base: ContractRenewalView = {
      decision_window_days: windowDays,
      state: state.kind,
      renegotiating: false,
      term: null,
      duration_months: Number(contract.duration_months ?? 0),
      decision: null,
      can_undo: false,
      task: null,
      impact: null,
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
        ? { decision: record.decision, reason: record.reason, decided_at: record.decided_at, decided_by_name: author?.name ?? null }
        : null,
      can_undo: state.kind === 'decided' && state.can_undo,
      task: task ? { id: task.id, item_number: task.item_number == null ? null : Number(task.item_number), status: task.status, assignee_name: task.assignee_name } : null,
      impact: state.kind === 'pending' ? await this.terminationImpact(mg, contract, state.term) : null,
    };
  }

  /** The renewal state of a contract of the session tenant. */
  async get(id: string, opts?: Opts): Promise<ContractRenewalView> {
    const mg = opts?.manager ?? this.dataSource.manager;
    const contract = await this.findContract(mg, id);
    const windowDays = await readDecisionWindowDays(mg, contract.tenant_id);
    return this.view(mg, contract, utcDateYmd(new Date()), windowDays);
  }

  // ----- Actions -----

  /**
   * One action on the renewal decision, `userId` the person deciding. `renew`, `terminate` and
   * `renegotiate` need a decision awaited (409 otherwise); `undo` needs a renewal or termination
   * whose deadline has not passed.
   */
  async act(id: string, action: RenewalAction, body: { reason?: unknown } | null | undefined, userId: string | null, opts?: Opts): Promise<ContractRenewalView> {
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
      const after = record.decision === 'terminate'
        ? await this.writeEndOfValidity(mg, contract, record.previous_disabled_at ? new Date(record.previous_disabled_at) : null)
        : contract;
      await this.logDecision(mg, contract, after, state.term, { decision: 'undo', reason, task_id: taskId }, userId);
      if (taskId) await this.updateTask(mg, taskId, tenantId, userId, { status: 'open', reason, reopen: true });
      return this.view(mg, after, today, windowDays);
    }

    if (state.kind !== 'pending') throw new ConflictException('No renewal decision is awaited for this contract.');
    const term = state.term;
    let after: Contract = contract;
    let previous: string | null | undefined;
    if (action === 'terminate') {
      previous = contract.disabled_at ? new Date(contract.disabled_at).toISOString() : null;
      after = await this.writeEndOfValidity(mg, contract, endOfValidityFromDate(term.term_end));
    }
    await this.logDecision(mg, contract, after, term, {
      decision: action,
      reason,
      task_id: taskId,
      ...(action === 'terminate' ? { previous_disabled_at: previous } : {}),
    }, userId);
    if (taskId) {
      await this.updateTask(mg, taskId, tenantId, userId, action === 'renegotiate' ? { reason } : { status: 'done', reason });
    }
    return this.view(mg, after, today, windowDays);
  }

  /**
   * Ends a contract already renewed with its current term (lot CR2): turning off its tacit renewal
   * would give it its first term only (`contract-terms.ts`), so the renewal stays on and the end of
   * validity goes to the current term's last day, as a termination does. One audit row. A contract
   * that already ends with or before its current term is left as it is. 409 when the renewal is off
   * or the contract is still in its first term (the renewal field itself is the way there).
   */
  async stopRenewal(id: string, userId: string | null, opts?: Opts): Promise<ContractRenewalView> {
    const mg = opts?.manager ?? this.dataSource.manager;
    const contract = await this.findContract(mg, id, true);
    const windowDays = await readDecisionWindowDays(mg, contract.tenant_id);
    const today = utcDateYmd(new Date());
    if (!contract.auto_renewal) throw new ConflictException('The tacit renewal of this contract is already off.');
    const terms = computeContractTerms(contract, today);
    if (terms.term_index === 0) throw new ConflictException('This contract has not been renewed yet: turn off its tacit renewal instead.');
    if (!terms.renews_at_term_end) return this.view(mg, contract, today, windowDays);
    const after = await this.writeEndOfValidity(mg, contract, endOfValidityFromDate(terms.current_term_end));
    await this.audit.log({ table: 'contracts', recordId: contract.id, action: 'update', before: contract, after, userId }, { manager: mg });
    return this.view(mg, after, today, windowDays);
  }

  /** Sets the contract's end of validity (its status follows it), as one targeted update. */
  private async writeEndOfValidity(mg: EntityManager, contract: Contract, disabledAt: Date | null): Promise<Contract> {
    const status = deriveStatusFromDisabledAt(disabledAt);
    await mg.query(
      `UPDATE contracts SET disabled_at = $3, status = $4, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [contract.tenant_id, contract.id, disabledAt, status],
    );
    const [saved] = await mg.getRepository(Contract).find({ where: { id: contract.id, tenant_id: contract.tenant_id }, take: 1 });
    return saved;
  }

  private async logDecision(
    mg: EntityManager,
    before: Contract,
    after: Contract,
    term: RenewalTerm,
    decision: { decision: RenewalAction; reason: string | null; task_id: string | null; previous_disabled_at?: string | null },
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
      const [owner]: Array<{ id: string; locale: string | null }> = contract.owner_user_id
        ? await mg.query(`SELECT id, locale FROM users WHERE tenant_id = $1 AND id = $2 AND status = 'enabled'`, [tenantId, contract.owner_user_id])
        : [];
      if (!owner) {
        result.withoutOwner.push({ contract_id: contract.id, contract_name: contract.name });
        continue;
      }
      const term = state.term;
      const text = renewalTaskText(resolveEmailLocale(owner.locale), contract.name, term);
      const sourceRef = renewalSourceRef(term.term_end);
      const task = await this.tasks.createForTarget(
        {
          type: 'contract',
          id: contract.id,
          payload: { title: text.title, description: text.description, due_date: term.deadline, assignee_user_id: owner.id, status: 'open' },
        },
        undefined,
        { manager: mg, tenantId, audit: { source: 'system', sourceRef } },
      );
      await this.audit.log({
        table: 'contracts',
        recordId: contract.id,
        action: 'update',
        before: { renewal_task: null },
        after: { renewal_task: { task_id: task.id, item_number: task.item_number ?? null, term_end: term.term_end, deadline: term.deadline } },
        userId: null,
        source: 'system',
        sourceRef,
      }, { manager: mg });
      result.created.push({ contract_id: contract.id, contract_name: contract.name, task_id: task.id, deadline: term.deadline });
    }
    return result;
  }
}

function normalizeReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, REASON_MAX_LENGTH) : null;
}
