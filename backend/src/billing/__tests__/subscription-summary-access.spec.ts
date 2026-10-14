import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthController } from '../../auth/auth.controller';
import { PermissionGuard } from '../../auth/permission.guard';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { Features } from '../../config/features';
import { BillingController } from '../billing.controller';
import { subscriptionStatusView, subscriptionSummaryFor } from '../subscription-summary-view';

/**
 * The subscription summary: every signed-in user reads its status (trial and freeze banners);
 * the payment method, amounts, invoices and Stripe ids only with a billing permission.
 */

const FULL_SUMMARY = {
  plan_name: 'max',
  status: 'trialing',
  trial_end: '2026-11-01T00:00:00.000Z',
  trial_days_remaining: 19,
  is_subscription_healthy: true,
  amount: 24900,
  currency: 'eur',
  default_payment_method_id: 'pm_1',
  default_payment_method_brand: 'visa',
  default_payment_method_last4: '4242',
  latest_invoice_id: 'in_1',
  latest_invoice_url: 'https://invoice.example.com/in_1',
  latest_invoice_pdf: 'https://invoice.example.com/in_1.pdf',
  stripe_customer_id: 'cus_1',
  stripe_subscription_id: 'sub_1',
  payment_due_at: '2026-11-01T00:00:00.000Z',
} as any;

const STATUS_KEYS = ['is_subscription_healthy', 'status', 'trial_days_remaining', 'trial_end'];

function testStatusViewHoldsNoPaymentDetail() {
  const view = subscriptionStatusView(FULL_SUMMARY);
  assert.deepEqual(Object.keys(view).sort(), STATUS_KEYS);
  assert.equal(view.trial_days_remaining, 19);
}

function testSubscriptionRouteNeedsBillingReader() {
  const handler = BillingController.prototype.subscription;
  const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, handler) ?? [];
  assert.ok(guards.includes(PermissionGuard), 'GET /billing/subscription checks the permission');
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, handler), { resource: 'billing', level: 'reader' });
}

function testOnlyKnownLevelsReadTheFullSummary() {
  for (const level of ['reader', 'contributor', 'member', 'admin']) {
    assert.deepEqual(subscriptionSummaryFor(FULL_SUMMARY, level), FULL_SUMMARY, `${level} reads the full summary`);
  }
  for (const level of ['none', '', 'owner', null, undefined]) {
    assert.deepEqual(
      Object.keys(subscriptionSummaryFor(FULL_SUMMARY, level)).sort(),
      STATUS_KEYS,
      `${String(level)} reads the status view`,
    );
  }
}

async function testSubscriptionRouteStaysOffOnPremise() {
  const previous = Features.STRIPE_BILLING;
  (Features as any).STRIPE_BILLING = false;
  try {
    let summaryRead = false;
    const controller = new BillingController({ getSubscriptionSummary: async () => { summaryRead = true; return FULL_SUMMARY; } } as any);
    await assert.rejects(() => controller.subscription({}));
    assert.equal(summaryRead, false);
  } finally {
    (Features as any).STRIPE_BILLING = previous;
  }
}

/** `GET /auth/me` for a user whose one role grants `permissions`. */
async function meFor(permissions: Array<[string, string]>) {
  const controller = new AuthController(
    {} as any,
    {
      findById: async () => ({
        id: 'user-1',
        email: 'user@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
        status: 'enabled',
        role_id: 'role-1',
        role: { role_name: 'Contributor' },
      }),
    } as any,
    { listForRoles: async () => new Map(permissions) } as any,
    { getSubscriptionSummary: async () => FULL_SUMMARY } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const manager = { getRepository: () => ({ find: async () => [] }) };
  return controller.me({ user: { sub: 'user-1' }, queryRunner: { manager } });
}

async function testMeKeepsPaymentDetailsForBillingUsers() {
  const withoutBilling = (await meFor([['tasks', 'member']])).subscription as Record<string, unknown>;
  assert.deepEqual(Object.keys(withoutBilling).sort(), STATUS_KEYS, 'status only without a billing permission');
  for (const field of ['default_payment_method_last4', 'latest_invoice_url', 'latest_invoice_pdf', 'amount', 'stripe_customer_id']) {
    assert.equal(field in withoutBilling, false, `${field} is left out`);
  }

  const billingReader = (await meFor([['tasks', 'member'], ['billing', 'reader']])).subscription;
  assert.deepEqual(billingReader, FULL_SUMMARY, 'a billing reader reads the full summary');
}

async function run() {
  testStatusViewHoldsNoPaymentDetail();
  testSubscriptionRouteNeedsBillingReader();
  testOnlyKnownLevelsReadTheFullSummary();
  await testSubscriptionRouteStaysOffOnPremise();
  await testMeKeepsPaymentDetailsForBillingUsers();
  console.log('subscription-summary-access.spec: all assertions passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
