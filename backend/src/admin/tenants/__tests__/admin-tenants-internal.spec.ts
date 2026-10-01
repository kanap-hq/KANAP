import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminTenantsService } from '../admin-tenants.service';
import { UpdateTenantPlanDto } from '../dto/update-tenant-plan.dto';
import { PaymentMode, Subscription, SubscriptionStatus } from '../../../billing/subscription.entity';
import { HEALTHY_STATUSES, INTERNAL_PLAN_NAME } from '../../../billing/plans.config';
import { evaluateSubscriptionAccess } from '../../../billing/subscription-freeze.util';
import { TenantStatus } from '../../../tenants/tenant.entity';

/**
 * Marking a tenant as internal (demonstration, test) and the status / trial end fields of
 * the platform-admin plan form. Repositories are in-memory: one tenant, one subscription row.
 */

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DAY_MS = 86400000;

type State = {
  tenant: { id: string; slug: string; name: string; status: TenantStatus; is_system_tenant: boolean };
  subscription: Partial<Subscription> | null;
  audits: any[];
  saves: number;
  findOptions: any[];
};

function createService(opts: {
  subscription?: Partial<Subscription> | null;
  tenant?: Partial<State['tenant']>;
}) {
  const state: State = {
    tenant: {
      id: TENANT_ID,
      slug: 'demo',
      name: 'Demo',
      status: TenantStatus.ACTIVE,
      is_system_tenant: false,
      ...(opts.tenant ?? {}),
    },
    subscription: opts.subscription === undefined ? null : opts.subscription,
    audits: [],
    saves: 0,
    findOptions: [],
  };

  const subscriptionRepo = {
    findOne: async (options: any) => {
      state.findOptions.push(options);
      return state.subscription;
    },
    create: (values: Partial<Subscription>) => ({ ...values }),
    save: async (entity: Partial<Subscription>) => {
      state.saves += 1;
      if (!entity.id) entity.id = 'sub-1';
      state.subscription = entity;
      return entity;
    },
  };
  const manager = {
    getRepository: (entity: unknown) => {
      if (entity !== Subscription) throw new Error('unexpected repository');
      return subscriptionRepo;
    },
  };
  const dataSource = {
    createQueryRunner: () => ({
      isTransactionActive: true,
      connect: async () => undefined,
      startTransaction: async () => undefined,
      commitTransaction: async () => undefined,
      rollbackTransaction: async () => undefined,
      release: async () => undefined,
      query: async () => [],
      manager,
    }),
  };
  const tenants = { findOne: async () => ({ ...state.tenant }) };
  const stats = { compute: async () => ({}) };
  const billing = { getSubscriptionSummary: async () => ({ ...state.subscription }) };
  const audit = { log: async (entry: any) => { state.audits.push(entry); } };

  const svc = new AdminTenantsService(
    tenants as any,
    {} as any,
    dataSource as any,
    stats as any,
    billing as any,
    audit as any,
    {} as any,
  );
  return { svc, state };
}

const expiredTrial = (): Partial<Subscription> => ({
  id: 'sub-1',
  tenant_id: TENANT_ID,
  status: SubscriptionStatus.TRIALING,
  trial_end: new Date(Date.now() - 3 * DAY_MS),
  plan_name: 'Trial',
  seat_limit: null,
  active_seats: 0,
  payment_mode: PaymentMode.CARD,
  next_payment_at: null,
  notes: null,
  stripe_customer_id: 'cus_demo',
  stripe_subscription_id: null,
  stripe_price_id: null,
});

/** Same rule as BillingService.getSubscriptionSummary `is_subscription_healthy`. */
function isHealthy(sub: Partial<Subscription>, now: number) {
  const status = sub.status ?? '';
  return (HEALTHY_STATUSES as readonly string[]).includes(status)
    && (status !== 'trialing' || (sub.trial_end != null && sub.trial_end.getTime() > now));
}

async function testExpiredTrialBecomesActiveInternal() {
  const { svc, state } = createService({ subscription: expiredTrial() });
  const now = Date.now();
  const beforeDecision = evaluateSubscriptionAccess(state.subscription as Subscription, now, true);
  assert.equal(beforeDecision.allowed, false);
  assert.equal(beforeDecision.reason, 'TRIAL_EXPIRED');

  await svc.markInternal(TENANT_ID, 'admin-1');

  const sub = state.subscription!;
  assert.equal(sub.status, SubscriptionStatus.ACTIVE);
  assert.equal(sub.trial_end, null);
  assert.equal(sub.plan_name, INTERNAL_PLAN_NAME);
  assert.equal(sub.seat_limit, null);
  assert.equal(sub.payment_mode, PaymentMode.BANK_TRANSFER);
  assert.equal(sub.next_payment_at, null);
  assert.equal(sub.stripe_customer_id, 'cus_demo', 'Stripe ids are left untouched');
  assert.equal(sub.stripe_subscription_id, null);
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(sub.notes, `Tenant interne (démonstration, test), marqué le ${today}`);

  assert.equal(evaluateSubscriptionAccess(sub as Subscription, Date.now(), true).allowed, true);
  assert.equal(isHealthy(sub, Date.now()), true);

  // Reads the row the access gates read (latest first) and locks it.
  assert.deepEqual(state.findOptions[0].order, { created_at: 'DESC' });
  assert.equal(state.findOptions[0].lock?.mode, 'pessimistic_write');

  assert.equal(state.audits.length, 1);
  const entry = state.audits[0];
  assert.equal(entry.table, 'tenants_plan');
  assert.equal(entry.action, 'update');
  assert.equal(entry.sourceRef, 'mark-internal');
  assert.equal(entry.userId, 'admin-1');
  assert.equal(entry.before.status, SubscriptionStatus.TRIALING);
  assert.equal(entry.after.status, SubscriptionStatus.ACTIVE);
  assert.equal(entry.after.plan_name, INTERNAL_PLAN_NAME);
}

async function testSecondClickIsNoOp() {
  const { svc, state } = createService({ subscription: expiredTrial() });
  await svc.markInternal(TENANT_ID, 'admin-1');
  const notes = state.subscription!.notes;
  const saves = state.saves;
  await svc.markInternal(TENANT_ID, 'admin-1');
  assert.equal(state.subscription!.notes, notes);
  assert.equal(state.saves, saves);
  assert.equal(state.audits.length, 1);
}

async function testExistingNotesAreKept() {
  const { svc, state } = createService({ subscription: { ...expiredTrial(), notes: 'Prospect from the fair' } });
  await svc.markInternal(TENANT_ID, null);
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(
    state.subscription!.notes,
    `Prospect from the fair\nTenant interne (démonstration, test), marqué le ${today}`,
  );
}

async function testMissingSubscriptionIsCreated() {
  const { svc, state } = createService({ subscription: null });
  await svc.markInternal(TENANT_ID, null);
  assert.equal(state.subscription!.status, SubscriptionStatus.ACTIVE);
  assert.equal(state.subscription!.plan_name, INTERNAL_PLAN_NAME);
  assert.equal(evaluateSubscriptionAccess(state.subscription as Subscription, Date.now(), true).allowed, true);
}

async function testRefusedOnSystemTenant() {
  const { svc, state } = createService({ subscription: expiredTrial(), tenant: { is_system_tenant: true } });
  await assert.rejects(() => svc.markInternal(TENANT_ID, null), BadRequestException);
  assert.equal(state.subscription!.status, SubscriptionStatus.TRIALING);
  assert.equal(state.saves, 0);
  assert.equal(state.audits.length, 0);
}

async function testRefusedOnDeletedTenant() {
  for (const status of [TenantStatus.DELETED, TenantStatus.DELETING]) {
    const { svc, state } = createService({ subscription: expiredTrial(), tenant: { status } });
    await assert.rejects(() => svc.markInternal(TENANT_ID, null), BadRequestException);
    assert.equal(state.saves, 0);
  }
}

async function testRefusedWhenStripeSubscriptionLinked() {
  // A live subscription is a paying customer; an ended one would be overwritten by the
  // billing page's Stripe refresh. Both are refused and the row stays as it was.
  for (const status of [
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.TRIALING,
    SubscriptionStatus.PAST_DUE,
    SubscriptionStatus.CANCELED,
    SubscriptionStatus.INCOMPLETE_EXPIRED,
  ]) {
    const { svc, state } = createService({
      subscription: {
        ...expiredTrial(),
        status,
        plan_name: 'Hosted KANAP',
        stripe_subscription_id: 'sub_live',
        stripe_price_id: 'price_1',
      },
    });
    await assert.rejects(
      () => svc.markInternal(TENANT_ID, null),
      (error: unknown) => error instanceof ConflictException && /Stripe subscription/.test((error as Error).message),
    );
    assert.equal(state.subscription!.status, status);
    assert.equal(state.subscription!.plan_name, 'Hosted KANAP');
    assert.equal(state.subscription!.stripe_subscription_id, 'sub_live');
    assert.equal(state.saves, 0);
    assert.equal(state.audits.length, 0);
  }
}

async function testPlanUpdateWritesStatusAndTrialEnd() {
  const { svc, state } = createService({ subscription: expiredTrial() });
  const trialEnd = new Date(Date.now() + 10 * DAY_MS).toISOString();
  await svc.updatePlan(TENANT_ID, 'admin-1', { status: SubscriptionStatus.TRIALING, trial_end: trialEnd });
  assert.equal(state.subscription!.status, SubscriptionStatus.TRIALING);
  assert.equal(state.subscription!.trial_end!.toISOString(), trialEnd);
  assert.equal(evaluateSubscriptionAccess(state.subscription as Subscription, Date.now(), true).allowed, true);
  assert.equal(state.audits.length, 1);
  assert.equal(state.audits[0].table, 'tenants_plan');
  assert.equal(state.audits[0].after.trial_end, trialEnd);

  // trial_end null clears it; an omitted status stays as it was.
  await svc.updatePlan(TENANT_ID, 'admin-1', { trial_end: null });
  assert.equal(state.subscription!.trial_end, null);
  assert.equal(state.subscription!.status, SubscriptionStatus.TRIALING);

  // Omitted trial_end stays as it was; seat_limit null means unlimited.
  await svc.updatePlan(TENANT_ID, 'admin-1', { status: SubscriptionStatus.ACTIVE, seat_limit: null });
  assert.equal(state.subscription!.status, SubscriptionStatus.ACTIVE);
  assert.equal(state.subscription!.trial_end, null);
  assert.equal(state.subscription!.seat_limit, null);
}

async function testPlanUpdateRefusedOnSystemTenant() {
  const { svc, state } = createService({ subscription: expiredTrial(), tenant: { is_system_tenant: true } });
  await assert.rejects(
    () => svc.updatePlan(TENANT_ID, null, { status: SubscriptionStatus.ACTIVE }),
    BadRequestException,
  );
  assert.equal(state.subscription!.status, SubscriptionStatus.TRIALING);
}

async function testDtoValidation() {
  const errorsFor = async (body: Record<string, unknown>) =>
    (await validate(plainToInstance(UpdateTenantPlanDto, body))).map((e) => e.property);

  assert.deepEqual(await errorsFor({ status: 'active', trial_end: '2026-10-15T00:00:00.000Z' }), []);
  assert.deepEqual(await errorsFor({ trial_end: null, seat_limit: null }), []);
  assert.deepEqual(await errorsFor({ status: 'expired' }), ['status']);
  assert.deepEqual(await errorsFor({ trial_end: 'next week' }), ['trial_end']);
  assert.deepEqual(await errorsFor({ seat_limit: -1 }), ['seat_limit']);
}

async function run() {
  await testExpiredTrialBecomesActiveInternal();
  await testSecondClickIsNoOp();
  await testExistingNotesAreKept();
  await testMissingSubscriptionIsCreated();
  await testRefusedOnSystemTenant();
  await testRefusedOnDeletedTenant();
  await testRefusedWhenStripeSubscriptionLinked();
  await testPlanUpdateWritesStatusAndTrialEnd();
  await testPlanUpdateRefusedOnSystemTenant();
  await testDtoValidation();
  console.log('admin-tenants-internal.spec: all tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
