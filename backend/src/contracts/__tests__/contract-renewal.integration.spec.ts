import 'dotenv/config';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { ItemNumberService } from '../../common/item-number.service';
import { CurrencyRateSet } from '../../currency/currency-rate-set.entity';
import { CurrencySettingsService } from '../../currency/currency-settings.service';
import { FxRateService } from '../../currency/fx-rate.service';
import { utcDateYmd } from '../../notifications/expiry-reminder-schedule';
import { PortfolioActivity } from '../../portfolio/portfolio-activity.entity';
import { Task } from '../../tasks/task.entity';
import { TaskActivitiesService } from '../../tasks/task-activities.service';
import { TasksUnifiedService } from '../../tasks/tasks-unified.service';
import { Tenant } from '../../tenants/tenant.entity';
import { seedCompany, seedUser } from '../../spend/__tests__/cost-center.fixtures';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant, underSavepoint } from '../../spend/__tests__/round-inputs.fixtures';
import { ContractRenewalService } from '../contract-renewal.service';
import { renewalTerms } from '../contract-renewal';
import { ContractSettingsService } from '../contract-settings.service';
import { ContractsService } from '../contracts.service';
import { addDaysYmd, addMonthsYmd } from '../contract-terms';

// The renewal decision (lot CR) against the database: the daily run creates one task per contract
// and term (twice the run, one task; the next term, a new task), none without an enabled owner or
// without tacit renewal; the tenant's decision window drives the list state, its quick filter
// count, the contract and the run; each action (renew, terminate, renegotiate, undo) writes the
// contract, the task, its comment and the audit row; a contract of another tenant is not found.
// Lot CR2: a renewal decided leaves "to decide" (list state, filter, count, contract) for the term
// decided, and comes back with its undoing; a contract already renewed keeps its renewal (an edit,
// an import) and ends with its current term through `stopRenewal`. Everything is seeded relative
// to today, on an empty database.

const TODAY = utcDateYmd(new Date());

type Seeded = { tenantId: string; ownerId: string; ids: Record<string, string> };

async function seed(runner: QueryRunner, tag: string): Promise<Seeded> {
  const tenantId = await seedTenant(runner, tag);
  const { companyId } = await seedCompany(runner, tenantId, `${tag} company`);
  const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, `${tag} supplier`]);
  const ownerId = await seedUser(runner, tenantId, `${tag}-owner-${tenantId.slice(0, 8)}@example.com`);
  const disabledOwner = await seedUser(runner, tenantId, `${tag}-gone-${tenantId.slice(0, 8)}@example.com`, 'disabled');
  const contract = async (name: string, owner: string | null, renewal = true, start = addDaysYmd(addMonthsYmd(TODAY, -12), 60)) => {
    // 12-month terms, 1 month notice: the deadline falls about 30 days from today.
    const [row] = await runner.query(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, owner_user_id, start_date, duration_months, notice_period_months,
                              auto_renewal, yearly_amount_at_signature, currency, status)
       VALUES ($1, $2, $3, $4, $5, $6, 12, 1, $7, 12000, 'EUR', 'enabled') RETURNING id`,
      [tenantId, name, companyId, supplier.id, owner, start, renewal],
    );
    return row.id as string;
  };
  const ids: Record<string, string> = {
    decide: await contract('Decide soon', ownerId),
    noOwner: await contract('No owner', null),
    goneOwner: await contract('Disabled owner', disabledOwner),
    noRenewal: await contract('No renewal', ownerId, false),
    // Deadline in about ten months: not to decide yet.
    later: await contract('Decide later', ownerId, true, addMonthsYmd(TODAY, -1)),
  };
  return { tenantId, ownerId, ids };
}

function services(runner: QueryRunner) {
  const audit = new AuditService(runner.manager.getRepository(AuditLog));
  const assigned: Array<{ taskId: string; assigneeId: string }> = [];
  const notifications = {
    notifyTaskAssigned: async (p: any) => { assigned.push({ taskId: p.taskId, assigneeId: p.assigneeId }); },
    getTaskRecipients: async () => [],
    notifyStatusChange: async () => undefined,
    notifyUnifiedAction: async () => undefined,
    notifyComment: async () => undefined,
  };
  const activities = new TaskActivitiesService(
    runner.manager.getRepository(PortfolioActivity), runner.manager.getRepository(Task), notifications as any, {} as any, audit,
  );
  const none = undefined as any;
  const tasks = new TasksUnifiedService(runner.manager.getRepository(Task), audit, none, none, notifications as any, new ItemNumberService(), activities, none, none);
  const renewal = new ContractRenewalService(none, audit, tasks, activities);
  const settings = new ContractSettingsService(runner.manager.getRepository(Tenant), audit);
  const currency = new CurrencySettingsService(runner.manager.getRepository(Tenant), audit as any);
  const fx = new FxRateService(runner.manager.getRepository(CurrencyRateSet), currency);
  const args: any[] = Array.from({ length: 10 }, () => undefined);
  args[4] = audit;
  args[9] = fx;
  const contracts: ContractsService = new (ContractsService as any)(...args);
  return { renewal, settings, contracts, assigned };
}

const decisionTasks = (runner: QueryRunner, contractId: string) => runner.query(
  `SELECT id, title, status, due_date::text AS due_date, assignee_user_id, item_number FROM tasks
    WHERE related_object_type = 'contract' AND related_object_id = $1 ORDER BY created_at, item_number`,
  [contractId],
);

async function expectRefusal<T>(runner: QueryRunner, kind: new (...args: any[]) => Error, fn: () => Promise<T>, label: string) {
  try {
    await underSavepoint(runner, fn);
  } catch (err) {
    assert.ok(err instanceof kind, `${label}: ${(err as Error).message}`);
    return;
  }
  throw new Error(`${label}: expected a refusal`);
}

async function testDailyRun() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, ownerId, ids } = await seed(runner, 'renewal-run');
    const { renewal, assigned } = services(runner);

    const first = await renewal.runForTenant(runner.manager, tenantId);
    assert.deepEqual(first.created.map((c) => c.contract_id).sort(), [ids.decide, ids.noRenewal].sort(), 'one task for each contract to decide that has an owner');
    assert.deepEqual(first.withoutOwner.map((c) => c.contract_id).sort(), [ids.goneOwner, ids.noOwner].sort(), 'no owner, or a disabled one: no task');
    const [task] = await decisionTasks(runner, ids.decide);
    const term = renewalTerms({ start_date: addDaysYmd(addMonthsYmd(TODAY, -12), 60), duration_months: 12, notice_period_months: 1, auto_renewal: true }, TODAY)!.pending;
    assert.equal(task.title, 'Decide on the renewal of Decide soon');
    assert.equal(task.due_date, term.deadline, 'due on the cancellation deadline');
    assert.equal(task.assignee_user_id, ownerId, 'assigned to the owner');
    assert.equal(task.status, 'open');
    assert.ok(Number(task.item_number) > 0, 'a task reference');
    assert.ok(assigned.some((n) => n.taskId === task.id && n.assigneeId === ownerId), 'the assignment notification goes out as for a task created by hand');
    assert.equal(assigned.length, 2, 'one per task created');

    const second = await renewal.runForTenant(runner.manager, tenantId);
    assert.equal(second.created.length, 0, 'a second run creates nothing');
    assert.equal((await decisionTasks(runner, ids.decide)).length, 1, 'still one task');
    await runner.query(`DELETE FROM tasks WHERE id = $1`, [task.id]);
    assert.equal((await renewal.runForTenant(runner.manager, tenantId)).created.length, 0, 'a deleted task is not created again for that term');
    // No renewal (lot CR2, round 2): its end within the window asks to renew it or let it end.
    const [endTask] = await decisionTasks(runner, ids.noRenewal);
    assert.equal(endTask.title, 'Decide whether to renew or let No renewal end');
    assert.equal(endTask.due_date, addDaysYmd(addMonthsYmd(addDaysYmd(addMonthsYmd(TODAY, -12), 60), 12), -1), 'due on its end');
    assert.equal((await decisionTasks(runner, ids.noRenewal)).length, 1, 'one task');
    assert.equal((await decisionTasks(runner, ids.later)).length, 0, 'outside the window, no task');

    // The next term: ten days before its deadline, a new task.
    const nextDeadline = addMonthsYmd(term.next_term_end, -1);
    const next = await renewal.runForTenant(runner.manager, tenantId, new Date(`${addDaysYmd(nextDeadline, -10)}T08:00:00Z`));
    assert.ok(next.created.some((c) => c.contract_id === ids.decide && c.deadline === nextDeadline), 'the next term gets its own task');

    // An owner given later: the task comes on the next run while the deadline has not passed.
    await runner.query(`UPDATE contracts SET owner_user_id = $2 WHERE id = $1`, [ids.noOwner, ownerId]);
    assert.deepEqual((await renewal.runForTenant(runner.manager, tenantId)).created.map((c) => c.contract_id), [ids.noOwner], 'created on the first run after');
  });
}

async function testWindowSetting() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, ids } = await seed(runner, 'renewal-window');
    const { renewal, settings, contracts } = services(runner);
    const opts = { manager: runner.manager };
    const stateOf = async (id: string) => ((await contracts.list({ limit: 50 }, opts)).items as any[]).find((r) => r.id === id)?.term_state;

    assert.equal((await settings.get(tenantId, runner.manager)).decision_window_days, 90, 'default 90 days');
    assert.equal(await stateOf(ids.decide), 'to_decide');
    await expectRefusal(runner, Error, () => settings.update(tenantId, { decision_window_days: 366 }, null, runner.manager), 'over 365');
    assert.equal((await settings.get(tenantId, runner.manager)).decision_window_days, 90, 'a refused value changes nothing');

    await settings.update(tenantId, { decision_window_days: 20 }, null, runner.manager);
    const [stored] = await runner.query(`SELECT metadata FROM tenants WHERE id = $1`, [tenantId]);
    assert.deepEqual(stored.metadata.contracts, { decision_window_days: 20 }, 'stored in the tenant metadata');
    assert.equal(await stateOf(ids.decide), 'in_progress', 'the list state reads the window');
    const totals = await contracts.totals({}, { ...opts, tenantId });
    assert.equal(totals.to_decide_count, 0, 'the quick filter count reads the window');
    assert.equal(totals.decision_window_days, 20, 'the list gets the window with its totals');
    const filtered = await contracts.list({ filters: JSON.stringify({ term_state: { filterType: 'set', values: ['to_decide'] } }) }, opts);
    assert.equal(filtered.total, 0, 'the state filter reads the window');
    const detail: any = await contracts.get(ids.decide, opts);
    assert.equal(detail.term_state, 'in_progress');
    assert.equal(detail.decision_window_days, 20, 'the contract carries the window');
    assert.equal((await renewal.get(ids.decide, opts)).state, 'none', 'no decision box outside the window');
    assert.equal((await renewal.runForTenant(runner.manager, tenantId)).created.length, 0, 'the run reads the window');

    await settings.update(tenantId, { decision_window_days: 90 }, null, runner.manager);
    assert.equal((await contracts.totals({}, { ...opts, tenantId })).to_decide_count, 4, 'four contracts to decide with 90 days, the one ending without renewal included');
    assert.equal((await renewal.get(ids.decide, opts)).state, 'pending');
  });
}

async function testActions() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, ownerId, ids } = await seed(runner, 'renewal-act');
    const { renewal, contracts } = services(runner);
    const opts = { manager: runner.manager };
    const id = ids.decide;
    // An application linked to the contract and an asset it supports.
    const [app] = await runner.query(`INSERT INTO applications (tenant_id, name) VALUES ($1, 'Linked application') RETURNING id`, [tenantId]);
    await runner.query(`INSERT INTO application_contracts (tenant_id, application_id, contract_id) VALUES ($1, $2, $3)`, [tenantId, app.id, id]);
    const [asset] = await runner.query(`INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, 'Supported server', 'server', 'prod') RETURNING id`, [tenantId]);
    await runner.query(`INSERT INTO asset_support_info (tenant_id, asset_id, support_contract_id) VALUES ($1, $2, $3)`, [tenantId, asset.id, id]);
    await renewal.runForTenant(runner.manager, tenantId);
    const [task] = await decisionTasks(runner, id);
    const comments = async () => (await runner.query(`SELECT content FROM portfolio_activities WHERE task_id = $1 AND type = 'comment' ORDER BY created_at`, [task.id])).map((r: any) => r.content);
    const taskStatus = async () => (await runner.query(`SELECT status FROM tasks WHERE id = $1`, [task.id]))[0].status;
    const contractRow = async () => (await runner.query(`SELECT auto_renewal, disabled_at FROM contracts WHERE id = $1`, [id]))[0];

    const pending = await renewal.get(id, opts);
    assert.equal(pending.state, 'pending');
    assert.equal(pending.task?.id, task.id, 'the box names the decision task');
    assert.equal(pending.task?.assignee_name, 'Cost Owner');
    assert.deepEqual(pending.impact?.applications.map((a) => a.name), ['Linked application'], 'applications that lose the contract');
    assert.deepEqual(pending.impact?.assets.map((a) => a.name), ['Supported server'], 'assets it supports');
    assert.ok((pending.impact?.commitments.length ?? 0) > 0, 'the commitment changes');
    const termEnd = pending.term!.term_end;

    const reneg = await renewal.act(id, 'renegotiate', { reason: 'Price up 4%, compare offers' }, ownerId, opts);
    assert.ok(reneg.state === 'pending' && reneg.renegotiating, 'renegotiation in progress');
    assert.equal(await taskStatus(), 'open', 'the task stays open');
    assert.deepEqual(await comments(), ['Price up 4%, compare offers'], 'the justification as a comment');

    const renewed = await renewal.act(id, 'renew', { reason: 'Best offer' }, ownerId, opts);
    assert.ok(renewed.state === 'decided' && renewed.decision?.decision === 'renew' && renewed.can_undo, 'renewal decided');
    assert.equal(renewed.decision?.decided_by_name, 'Cost Owner', 'decided by');
    assert.equal(await taskStatus(), 'done', 'the task is done');
    assert.deepEqual(await contractRow(), { auto_renewal: true, disabled_at: null }, 'a renewal changes nothing on the contract');
    await expectRefusal(runner, ConflictException, () => renewal.act(id, 'terminate', {}, ownerId, opts), 'no second decision once decided');

    const undone = await renewal.act(id, 'undo', {}, ownerId, opts);
    assert.equal(undone.state, 'pending', 'undone: the decision is awaited again');
    assert.equal(await taskStatus(), 'open', 'the task opens again');

    const terminated = await renewal.act(id, 'terminate', { reason: 'Moving to another vendor' }, ownerId, opts);
    assert.ok(terminated.state === 'decided' && terminated.decision?.decision === 'terminate' && terminated.can_undo, 'termination decided');
    const ended = await contractRow();
    assert.equal(ended.auto_renewal, false, 'the renewal turns off (the term rule keeps its terms up to the end of validity)');
    assert.equal(new Date(ended.disabled_at).toISOString(), `${termEnd}T12:00:00.000Z`, 'the contract ends with the term decided');
    const detail: any = await contracts.get(id, opts);
    assert.equal(detail.term_state, 'ending', 'the contract now ends without renewal');
    assert.equal(detail.current_term_end, termEnd);
    assert.equal(await taskStatus(), 'done');
    const [log] = await runner.query(
      `SELECT after_json->'renewal_decision'->>'decision' AS decision, user_id FROM audit_log
        WHERE tenant_id = $1 AND table_name = 'contracts' AND record_id = $2 AND source_ref = $3 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [tenantId, id, `contract-renewal:${termEnd}`],
    );
    assert.deepEqual(log, { decision: 'terminate', user_id: ownerId }, 'the decision is in the audit log');

    const restored = await renewal.act(id, 'undo', {}, ownerId, opts);
    assert.equal(restored.state, 'pending');
    assert.deepEqual(await contractRow(), { auto_renewal: true, disabled_at: null }, 'the undoing puts the renewal and the end of validity back');
    await expectRefusal(runner, ConflictException, () => renewal.act(id, 'undo', {}, ownerId, opts), 'nothing to undo');
    await expectRefusal(runner, ConflictException, () => renewal.act(ids.later, 'renew', {}, ownerId, opts), 'no decision awaited outside the window');
  });
}

async function testConfirmedRenewalLeavesToDecide() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, ownerId, ids } = await seed(runner, 'renewal-confirmed');
    const { renewal, contracts } = services(runner);
    const opts = { manager: runner.manager };
    const id = ids.decide;
    const toDecideFilter = { filters: JSON.stringify({ term_state: { filterType: 'set', values: ['to_decide'] } }) };
    const listed = async () => ((await contracts.list({ limit: 50 }, opts)).items as any[]).find((r) => r.id === id)?.term_state;
    const filteredIds = async () => ((await contracts.list(toDecideFilter, opts)).items as any[]).map((r) => r.id);
    const count = async () => (await contracts.totals({}, { ...opts, tenantId })).to_decide_count;
    const detail = async () => ((await contracts.get(id, opts)) as any).term_state;

    assert.equal(await count(), 4, 'four contracts to decide');
    assert.ok((await filteredIds()).includes(id));
    const renewed = await renewal.act(id, 'renew', { reason: 'Keep it' }, ownerId, opts);
    const termEnd = renewed.term!.term_end;
    assert.equal(await listed(), 'in_progress', 'the list state leaves "to decide" once the renewal is decided');
    assert.ok(!(await filteredIds()).includes(id), 'the "to decide" filter leaves it out');
    assert.equal(await count(), 3, 'the count follows');
    assert.equal(await detail(), 'in_progress', 'the contract too');
    const exported = await contracts.listIds(toDecideFilter, opts);
    assert.ok(!exported.ids.includes(id), 'the ids of the filtered list too');

    await renewal.act(id, 'undo', {}, ownerId, opts);
    assert.equal(await listed(), 'to_decide', 'undone: to decide again');
    assert.equal(await count(), 4);
    await renewal.act(id, 'renegotiate', { reason: 'Ask for a discount' }, ownerId, opts);
    assert.equal(await listed(), 'to_decide', 'a renegotiation keeps it to decide');
    await renewal.act(id, 'renew', {}, ownerId, opts);
    assert.equal(await count(), 3, 'renewed after the renegotiation');

    // A renewal confirmed for another term (the next one) leaves this term to decide.
    const other = ids.noOwner;
    const otherTerm = (await renewal.get(other, opts)).term!;
    await runner.query(
      `INSERT INTO audit_log (tenant_id, table_name, record_id, action, before_json, after_json, user_id, source, source_ref)
       VALUES ($1, 'contracts', $2, 'update', NULL, $3::jsonb, NULL, 'user', $4)`,
      [tenantId, other, JSON.stringify({ renewal_decision: { decision: 'renew', term_end: otherTerm.next_term_end } }), `contract-renewal:${otherTerm.next_term_end}`],
    );
    assert.ok((await filteredIds()).includes(other), 'a renewal of the next term does not count for this one');
    assert.ok(termEnd > TODAY);
  });
}

async function testRenewedContractKeepsRenewal() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, ownerId, ids } = await seed(runner, 'renewal-keep');
    const { renewal, contracts } = services(runner);
    const opts = { manager: runner.manager };
    // Second term: 12-month terms from about two years ago.
    const start = addDaysYmd(addMonthsYmd(TODAY, -24), 60);
    const [row] = await runner.query(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, owner_user_id, start_date, duration_months, notice_period_months,
                              auto_renewal, yearly_amount_at_signature, currency, status)
       SELECT tenant_id, 'Renewed once', company_id, supplier_id, owner_user_id, $2, 12, 1, true, 12000, 'EUR', 'enabled'
         FROM contracts WHERE id = $1 RETURNING id`,
      [ids.decide, start],
    );
    const id = row.id as string;
    const contractRow = async () => (await runner.query(`SELECT auto_renewal, disabled_at FROM contracts WHERE id = $1`, [id]))[0];
    const auditCount = async () => Number((await runner.query(`SELECT count(*) AS n FROM audit_log WHERE tenant_id = $1 AND record_id = $2`, [tenantId, id]))[0].n);

    await expectRefusal(runner, BadRequestException, () => contracts.update(id, { auto_renewal: false }, ownerId, opts), 'renewal off on a renewed contract');
    await expectRefusal(runner, BadRequestException, () => contracts.update(id, { auto_renewal: null }, ownerId, opts), 'renewal null on a renewed contract');
    assert.deepEqual(await contractRow(), { auto_renewal: true, disabled_at: null }, 'unchanged');
    await contracts.update(ids.later, { auto_renewal: false }, ownerId, opts);
    assert.equal((await runner.query(`SELECT auto_renewal FROM contracts WHERE id = $1`, [ids.later]))[0].auto_renewal, false, 'first term: the renewal turns off as before');
    await contracts.update(id, { notes: 'Kept' }, ownerId, opts);

    // The import refuses the row, dry run included, and writes nothing.
    const csv = [
      'name;company_name;supplier_name;start_date;duration_months;auto_renewal;notice_period_months;yearly_amount_at_signature;currency;billing_frequency;status;owner_email;notes',
      `Renewed once;renewal-keep company;renewal-keep supplier;${start};12;no;1;12000;EUR;annual;;;`,
    ].join('\n');
    const file = { buffer: Buffer.from(csv, 'utf8'), originalname: 'contracts.csv' } as any;
    for (const dryRun of [true, false]) {
      const result: any = await contracts.importCsv({ file, dryRun, userId: ownerId }, opts);
      assert.equal(result.ok, false, `import (dry run ${dryRun}) refused`);
      assert.deepEqual(result.errors.map((e: any) => e.row), [2], 'on the row of the contract');
      assert.match(result.errors[0].message, /^auto_renewal: This contract has already been renewed/);
    }
    assert.deepEqual(await contractRow(), { auto_renewal: true, disabled_at: null }, 'the import wrote nothing');

    // Turning the renewal off in the decision window (lot CR2, round 2): no decision, the task asks about the end.
    await renewal.runForTenant(runner.manager, tenantId);
    const [task] = await decisionTasks(runner, id);
    assert.equal(task.title, 'Decide on the renewal of Renewed once');
    const currentTermEnd = addDaysYmd(addMonthsYmd(start, 24), -1);
    const pendingView = await renewal.get(id, opts);
    assert.ok(pendingView.state === 'pending' && pendingView.mode === 'renewal');
    assert.equal(pendingView.proposed_end_date, currentTermEnd, 'proposed: the current term end, its deadline ahead');
    assert.equal(pendingView.notice_period_months, 1);
    const chosen = addDaysYmd(TODAY, 20);
    const stopped = await renewal.stopRenewal(id, { end_date: chosen }, ownerId, opts);
    assert.ok(stopped.state === 'pending' && stopped.mode === 'end', 'a decision is now awaited on its end');
    const ended = await contractRow();
    assert.equal(ended.auto_renewal, false, 'the renewal is off: the field reads No');
    assert.equal(new Date(ended.disabled_at).toISOString(), `${chosen}T12:00:00.000Z`, 'ends on the day chosen');
    const decisionsLogged = await runner.query(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND record_id = $2 AND after_json ? 'renewal_decision'`, [tenantId, id]);
    assert.equal(decisionsLogged[0].n, 0, 'no decision recorded');
    const [stopRow] = await runner.query(`SELECT after_json->'renewal_stop'->>'end_date' AS end_date FROM audit_log WHERE tenant_id = $1 AND record_id = $2 AND after_json ? 'renewal_stop'`, [tenantId, id]);
    assert.equal(stopRow.end_date, chosen, 'one audit row with the day');
    const [adapted] = await decisionTasks(runner, id);
    assert.equal(adapted.id, task.id, 'the same task');
    assert.equal(adapted.status, 'open');
    assert.equal(adapted.title, 'Decide whether to renew or let Renewed once end', 'its title asks about the end');
    assert.equal(adapted.due_date, chosen, 'due on the end');
    const [y, m, d] = chosen.split('-');
    const [comment] = await runner.query(`SELECT content FROM portfolio_activities WHERE task_id = $1 AND type = 'comment' ORDER BY created_at DESC LIMIT 1`, [task.id]);
    assert.equal(comment.content, `Tacit renewal turned off: the contract ends on ${d}/${m}/${y}, unless renewed.`, 'a comment saying why');
    assert.equal((await renewal.runForTenant(runner.manager, tenantId)).created.filter((c) => c.contract_id === id).length, 0, 'the run creates no second task');
    const detail: any = await contracts.get(id, opts);
    assert.equal(detail.term_index, 1, 'its past term is kept');
    assert.equal(detail.term_state, 'to_decide', 'its end within the window, nothing decided');
    await expectRefusal(runner, ConflictException, () => renewal.stopRenewal(id, {}, ownerId, opts), 'the renewal is already off');
    await expectRefusal(runner, ConflictException, () => renewal.act(id, 'terminate', {}, ownerId, opts), 'no termination of a contract without renewal');

    // Let it end, undo; renew, undo.
    const letEnd = await renewal.act(id, 'end', { reason: 'No longer needed' }, ownerId, opts);
    assert.ok(letEnd.state === 'decided' && letEnd.mode === 'end' && letEnd.decision?.decision === 'end' && letEnd.can_undo, 'left to end');
    assert.equal((await runner.query(`SELECT status FROM tasks WHERE id = $1`, [task.id]))[0].status, 'done', 'the task is closed');
    assert.equal(new Date((await contractRow()).disabled_at).toISOString(), `${chosen}T12:00:00.000Z`, 'the end is unchanged');
    assert.equal(((await contracts.get(id, opts)) as any).term_state, 'ending', 'no longer to decide');
    await renewal.act(id, 'undo', {}, ownerId, opts);
    assert.equal((await renewal.get(id, opts)).state, 'pending', 'undone: awaited again');
    assert.equal((await runner.query(`SELECT status FROM tasks WHERE id = $1`, [task.id]))[0].status, 'open', 'the task opens again');
    const renewedBack = await renewal.act(id, 'renew', {}, ownerId, opts);
    assert.ok(renewedBack.state === 'decided' && renewedBack.decision?.decision === 'renew' && renewedBack.can_undo, 'renewed, undoable');
    assert.deepEqual(await contractRow(), { auto_renewal: true, disabled_at: null }, 'the renewal is on, the end of validity gone');
    await renewal.act(id, 'undo', {}, ownerId, opts);
    const back = await contractRow();
    assert.equal(back.auto_renewal, false, 'undone: the renewal is off again');
    assert.equal(new Date(back.disabled_at).toISOString(), `${chosen}T12:00:00.000Z`, 'and the end is back');

    // The PATCH: turning the renewal off with an end of validity in the same request keeps the terms.
    await runner.query(`UPDATE contracts SET auto_renewal = true, disabled_at = NULL WHERE id = $1`, [id]);
    await contracts.update(id, { auto_renewal: false, disabled_at: `${currentTermEnd}T12:00:00.000Z` } as any, ownerId, opts);
    assert.equal(((await contracts.get(id, opts)) as any).term_index, 1, 'with an end of validity: allowed, its past term kept');
    await runner.query(`UPDATE contracts SET auto_renewal = true, disabled_at = NULL, status = 'enabled' WHERE id = $1`, [id]);

    // A termination from the box takes an end of its own too; a day before today is refused.
    await expectRefusal(runner, BadRequestException, () => renewal.act(id, 'terminate', { end_date: addDaysYmd(TODAY, -1) }, ownerId, opts), 'end before today');
    await expectRefusal(runner, BadRequestException, () => renewal.act(id, 'terminate', { end_date: '2027-02-30' }, ownerId, opts), 'not a calendar day');
    assert.deepEqual(await contractRow(), { auto_renewal: true, disabled_at: null }, 'a refused end writes nothing');
    const boxEnd = addDaysYmd(TODAY, 5);
    const terminated = await renewal.act(id, 'terminate', { end_date: boxEnd, reason: 'Ends early' }, ownerId, opts);
    assert.ok(terminated.state === 'decided' && terminated.decision?.decision === 'terminate', 'a termination on a day before the term end stands');
    const terminatedRow = await contractRow();
    assert.equal(terminatedRow.auto_renewal, false, 'a termination turns the renewal off');
    assert.equal(new Date(terminatedRow.disabled_at).toISOString(), `${boxEnd}T12:00:00.000Z`);
    assert.equal(((await contracts.get(id, opts)) as any).term_state, 'ending', 'terminated: no longer to decide');
    await renewal.act(id, 'undo', {}, ownerId, opts);
    assert.deepEqual(await contractRow(), { auto_renewal: true, disabled_at: null }, 'undone: both values back');

    await expectRefusal(runner, ConflictException, () => renewal.stopRenewal(ids.later, {}, ownerId, opts), 'first term, no decision awaited');
    await expectRefusal(runner, ConflictException, () => renewal.stopRenewal(ids.noRenewal, {}, ownerId, opts), 'no renewal to stop');
  });
}

async function testEndOutsideTheWindow() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, ownerId, ids } = await seed(runner, 'renewal-late');
    const { renewal } = services(runner);
    const opts = { manager: runner.manager };
    // As Axians: the current term's deadline has passed, the next deadline is far ahead (12-month terms, 6 months notice).
    const start = addMonthsYmd(TODAY, -21);
    const [row] = await runner.query(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, owner_user_id, start_date, duration_months, notice_period_months,
                              auto_renewal, yearly_amount_at_signature, currency, status)
       SELECT tenant_id, 'Notice passed', company_id, supplier_id, owner_user_id, $2, 12, 6, true, 12000, 'EUR', 'enabled'
         FROM contracts WHERE id = $1 RETURNING id`,
      [ids.decide, start],
    );
    const id = row.id as string;
    const terms = renewalTerms({ start_date: start, duration_months: 12, notice_period_months: 6, auto_renewal: true }, TODAY)!;
    const currentTermEnd = addDaysYmd(addMonthsYmd(start, 24), -1);
    const view = await renewal.get(id, opts);
    assert.equal(view.state, 'none', 'no decision awaited');
    assert.equal(view.proposed_end_date, terms.pending.term_end, 'proposed: the end of the first term whose deadline is ahead');
    assert.ok(view.proposed_end_date! > currentTermEnd, 'after the current term, whose notice has passed');
    assert.equal(view.notice_period_months, 6);
    assert.equal(view.impact, null);
    const early = addDaysYmd(TODAY, 30);
    const preview = await renewal.get(id, { ...opts, endDate: early });
    assert.ok((preview.impact?.commitments.length ?? 0) > 0, 'the consequences follow the day asked');
    await expectRefusal(runner, BadRequestException, () => renewal.get(id, { ...opts, endDate: addDaysYmd(TODAY, -1) }), 'preview before today');

    const auditRows = async () => runner.query(
      `SELECT after_json->'renewal_stop'->>'end_date' AS end_date FROM audit_log WHERE tenant_id = $1 AND record_id = $2 AND after_json ? 'renewal_stop' ORDER BY created_at, id`,
      [tenantId, id],
    );
    await expectRefusal(runner, BadRequestException, () => renewal.stopRenewal(id, { end_date: addDaysYmd(TODAY, -1) }, ownerId, opts), 'before today');
    await renewal.stopRenewal(id, {}, ownerId, opts);
    const row0 = (await runner.query(`SELECT auto_renewal, disabled_at FROM contracts WHERE id = $1`, [id]))[0];
    assert.equal(row0.auto_renewal, false);
    assert.equal(new Date(row0.disabled_at).toISOString(), `${terms.pending.term_end}T12:00:00.000Z`, 'no date: the proposed end');
    assert.deepEqual((await auditRows()).map((r: any) => r.end_date), [terms.pending.term_end], 'one audit row, with the day');
    assert.equal((await renewal.get(id, opts)).state, 'none', 'its end is outside the window: nothing awaited yet');
    assert.equal((await decisionTasks(runner, id)).length, 0, 'no task outside the window');

    // Another one ending within the window: a task is created at once, keyed as the run keys it.
    const [row2] = await runner.query(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, owner_user_id, start_date, duration_months, notice_period_months,
                              auto_renewal, yearly_amount_at_signature, currency, status)
       SELECT tenant_id, 'Notice passed soon', company_id, supplier_id, owner_user_id, $2, 12, 6, true, 12000, 'EUR', 'enabled'
         FROM contracts WHERE id = $1 RETURNING id`,
      [ids.decide, start],
    );
    await renewal.stopRenewal(row2.id, { end_date: early }, ownerId, opts);
    const [created] = await decisionTasks(runner, row2.id);
    assert.equal(created.title, 'Decide whether to renew or let Notice passed soon end');
    assert.equal(created.due_date, early, 'due on the end');
    assert.equal(created.assignee_user_id, ownerId);
    assert.equal((await renewal.runForTenant(runner.manager, tenantId)).created.filter((c) => c.contract_id === row2.id).length, 0, 'the run creates no second task');
    assert.equal((await renewal.get(row2.id, opts)).task?.id, created.id, 'the box names it');
  });
}

async function testResumeRenewal() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, ownerId, ids } = await seed(runner, 'renewal-resume');
    const { renewal, settings } = services(runner);
    const opts = { manager: runner.manager };
    // Second term, 12-month terms, 1 month notice: the deadline about 29 days away.
    const start = addDaysYmd(addMonthsYmd(TODAY, -24), 60);
    const insert = async (name: string) => (await runner.query(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, owner_user_id, start_date, duration_months, notice_period_months,
                              auto_renewal, yearly_amount_at_signature, currency, status)
       SELECT tenant_id, $3, company_id, supplier_id, owner_user_id, $2, 12, 1, true, 12000, 'EUR', 'enabled'
         FROM contracts WHERE id = $1 RETURNING id`,
      [ids.decide, start, name],
    ))[0].id as string;
    const row = async (id: string) => (await runner.query(`SELECT auto_renewal, disabled_at FROM contracts WHERE id = $1`, [id]))[0];
    const taskOf = async (id: string) => (await decisionTasks(runner, id))[0];
    const deadline = addMonthsYmd(addDaysYmd(addMonthsYmd(start, 24), -1), -1);

    // 1. A decision awaited on its end: turning the renewal back on is its "renew".
    const a = await insert('Resume in the window');
    await renewal.runForTenant(runner.manager, tenantId);
    const taskA = await taskOf(a);
    const chosen = addDaysYmd(TODAY, 20);
    await renewal.stopRenewal(a, { end_date: chosen }, ownerId, opts);
    assert.equal((await renewal.get(a, opts)).mode, 'end');
    const resumed = await renewal.resumeRenewal(a, ownerId, opts);
    assert.ok(resumed.state === 'decided' && resumed.decision?.decision === 'renew' && resumed.can_undo, 'recorded as the renewal of the end');
    assert.deepEqual(await row(a), { auto_renewal: true, disabled_at: null }, 'renewal on, the end removed');
    assert.equal((await taskOf(a)).status, 'done', 'the task is closed');
    assert.equal(taskA.id, (await taskOf(a)).id);
    await renewal.act(a, 'undo', {}, ownerId, opts);
    const undone = await row(a);
    assert.equal(undone.auto_renewal, false, 'undone: the renewal off again');
    assert.equal(new Date(undone.disabled_at).toISOString(), `${chosen}T12:00:00.000Z`, 'and the end back');

    // 2. The end outside the window, the renewal deadline within it: the task becomes the renewal decision's again.
    await settings.update(tenantId, { decision_window_days: 40 }, null, runner.manager);
    const b = await insert('Resume back to the deadline');
    await renewal.runForTenant(runner.manager, tenantId);
    const taskB = await taskOf(b);
    await renewal.stopRenewal(b, {}, ownerId, opts);
    assert.equal((await renewal.get(b, opts)).state, 'none', 'the end (about 59 days) is outside 40 days');
    assert.equal((await taskOf(b)).title, 'Decide whether to renew or let Resume back to the deadline end');
    const before = Number((await runner.query(`SELECT count(*) AS n FROM audit_log WHERE tenant_id = $1 AND record_id = $2`, [tenantId, b]))[0].n);
    const viewB = await renewal.resumeRenewal(b, ownerId, opts);
    assert.ok(viewB.state === 'pending' && viewB.mode === 'renewal', 'the renewal decision is awaited again');
    assert.deepEqual(await row(b), { auto_renewal: true, disabled_at: null });
    assert.equal(Number((await runner.query(`SELECT count(*) AS n FROM audit_log WHERE tenant_id = $1 AND record_id = $2`, [tenantId, b]))[0].n), before + 1, 'one audit row');
    const [resumeRow] = await runner.query(`SELECT after_json->'renewal_resume'->>'previous_end_date' AS d FROM audit_log WHERE tenant_id = $1 AND record_id = $2 AND after_json ? 'renewal_resume'`, [tenantId, b]);
    assert.ok(resumeRow.d, 'the audit row names the end removed');
    const backB = await taskOf(b);
    assert.equal(backB.id, taskB.id, 'the same task');
    assert.equal(backB.status, 'open');
    assert.equal(backB.title, 'Decide on the renewal of Resume back to the deadline', 'the renewal decision title again');
    assert.equal(backB.due_date, deadline, 'due on the cancellation deadline');
    assert.equal(viewB.task?.id, taskB.id, 'the box names it');
    // One transaction: the comments share a timestamp, so look for it among them.
    const comments: Array<{ content: string }> = await runner.query(`SELECT content FROM portfolio_activities WHERE task_id = $1 AND type = 'comment'`, [taskB.id]);
    assert.ok(comments.some((cm) => /^Tacit renewal turned back on: the end on \d{2}\/\d{2}\/\d{4} is removed\.$/.test(cm.content)), 'a comment saying why');
    assert.equal((await renewal.runForTenant(runner.manager, tenantId)).created.filter((c) => c.contract_id === b).length, 0, 'the run creates no second task');

    // 3. Nothing to decide on the renewal yet: the end task is closed.
    const c = await insert('Resume far from the deadline');
    await renewal.stopRenewal(c, { end_date: addDaysYmd(TODAY, 30) }, ownerId, opts);
    const taskC = await taskOf(c);
    assert.equal(taskC.title, 'Decide whether to renew or let Resume far from the deadline end', 'created: its end within 40 days');
    await settings.update(tenantId, { decision_window_days: 10 }, null, runner.manager);
    const viewC = await renewal.resumeRenewal(c, ownerId, opts);
    assert.equal(viewC.state, 'none');
    assert.equal((await taskOf(c)).status, 'done', 'the end task is closed');

    // 4. An end of validity set by hand: the same.
    await runner.query(`UPDATE contracts SET auto_renewal = false, disabled_at = $2 WHERE id = $1`, [ids.later, `${addDaysYmd(TODAY, 200)}T12:00:00.000Z`]);
    await renewal.resumeRenewal(ids.later, ownerId, opts);
    assert.deepEqual(await row(ids.later), { auto_renewal: true, disabled_at: null }, 'renewal on, the end removed');

    await expectRefusal(runner, ConflictException, () => renewal.resumeRenewal(ids.later, ownerId, opts), 'already on');
    await expectRefusal(runner, ConflictException, () => renewal.resumeRenewal(ids.noRenewal, ownerId, opts), 'no end of validity');
  });
}

async function testTenantIsolation() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seed(runner, 'renewal-a');
    const b = await seed(runner, 'renewal-b');
    const { renewal } = services(runner);
    await setTenant(runner, b.tenantId);
    const opts = { manager: runner.manager };
    await expectRefusal(runner, NotFoundException, () => renewal.get(a.ids.decide, opts), 'read another tenant');
    for (const action of ['renew', 'terminate', 'renegotiate', 'undo'] as const) {
      await expectRefusal(runner, NotFoundException, () => renewal.act(a.ids.decide, action, {}, b.ownerId, opts), `${action} on another tenant`);
    }
    await expectRefusal(runner, NotFoundException, () => renewal.get('not-a-uuid', opts), 'an invalid id');
    await expectRefusal(runner, NotFoundException, () => renewal.stopRenewal(a.ids.decide, {}, b.ownerId, opts), 'stop on another tenant');
    await expectRefusal(runner, NotFoundException, () => renewal.resumeRenewal(a.ids.decide, b.ownerId, opts), 'resume on another tenant');
  });
}

runSpecs('contract-renewal.integration', [
  ['daily run', testDailyRun],
  ['window setting', testWindowSetting],
  ['actions', testActions],
  ['a renewal decided leaves "to decide"', testConfirmedRenewalLeavesToDecide],
  ['a renewed contract keeps its renewal', testRenewedContractKeepsRenewal],
  ['an end chosen outside the window', testEndOutsideTheWindow],
  ['the renewal turned back on', testResumeRenewal],
  ['tenant isolation', testTenantIsolation],
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
