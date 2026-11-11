import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { backendPath } from '../../common/__tests__/backend-root';
import { PRODUCT_NAME } from '../../config/product';
import {
  INVOICE_PAYMENT_TERM_DAYS,
  PLANS,
  isBankTransferEligible,
  isHealthySubscription,
  isLiveSubscriptionStatus,
  planNameForDisplay,
  resolvePlanKeyFromLegacyName,
  resolvePlanKeyFromPriceId,
  toPlanDisplayName,
  trialEndFromSignup,
} from '../plans.config';

function testSingleSellablePlan() {
  const keys = Object.keys(PLANS);
  assert.deepEqual(keys, ['max']);
  const plan = PLANS.max;
  assert.equal(plan.displayName, `${PRODUCT_NAME} Cloud`);
  assert.equal(plan.seatLimit, null);
  assert.equal(plan.invoiceEligible, true);
  assert.equal(plan.prices.monthly, 24900);
  assert.equal(plan.prices.annual, 249000);
}

function testLegacyNameResolution() {
  assert.equal(resolvePlanKeyFromLegacyName('Hosted KANAP'), 'max');
  assert.equal(resolvePlanKeyFromLegacyName('hosted kanap'), 'max');
  assert.equal(resolvePlanKeyFromLegacyName('max'), 'max');
  assert.equal(resolvePlanKeyFromLegacyName('Trial'), null);
  assert.equal(resolvePlanKeyFromLegacyName('Starter'), null);
  assert.equal(resolvePlanKeyFromLegacyName(null), null);
  // The current display name, built from the product name, resolves as the stored legacy one does.
  assert.equal(toPlanDisplayName('max'), `${PRODUCT_NAME} Cloud`);
  assert.equal(resolvePlanKeyFromLegacyName(`${PRODUCT_NAME} Cloud`), 'max');
  assert.equal(resolvePlanKeyFromLegacyName(`  ${PRODUCT_NAME.toLowerCase()} cloud `), 'max');
}

function testStoredPlanNameShowsTheCurrentName() {
  // A subscription stored under the legacy name shows the current one: no data migration on a rename.
  assert.equal(planNameForDisplay('Hosted KANAP'), `${PRODUCT_NAME} Cloud`);
  assert.equal(planNameForDisplay('max'), `${PRODUCT_NAME} Cloud`);
  // Names that are no sellable plan stay as stored.
  assert.equal(planNameForDisplay('Trial'), 'Trial');
  assert.equal(planNameForDisplay('On-Prem'), 'On-Prem');
  assert.equal(planNameForDisplay('Internal'), 'Internal');
  assert.equal(planNameForDisplay(null), null);
}

function testPriceIdResolution() {
  process.env.STRIPE_PRICE_MAX_MONTHLY = 'price_max_monthly_test';
  process.env.STRIPE_PRICE_MAX_ANNUAL = 'price_max_annual_test';
  assert.equal(resolvePlanKeyFromPriceId('price_max_monthly_test'), 'max');
  assert.equal(resolvePlanKeyFromPriceId('price_max_annual_test'), 'max');
  assert.equal(resolvePlanKeyFromPriceId('price_unknown'), null);
  delete process.env.STRIPE_PRICE_MAX_MONTHLY;
  delete process.env.STRIPE_PRICE_MAX_ANNUAL;
}

function testBankTransferEligibility() {
  // 249 EUR monthly is below the 1,000 EUR bank-transfer floor; 2,490 EUR annual is above.
  assert.equal(isBankTransferEligible('max', 'monthly'), false);
  assert.equal(isBankTransferEligible('max', 'annual'), true);
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

function testTrialEndsAtEndOfSignupDay() {
  // 26 October, morning or evening: the fourteenth day is 8 November, the trial ends at its end (UTC).
  const end = '2026-11-08T23:59:59.999Z';
  assert.equal(trialEndFromSignup(new Date('2026-10-26T08:00:00.000Z')).toISOString(), end);
  assert.equal(trialEndFromSignup(new Date('2026-10-26T23:30:00.000Z')).toISOString(), end);
  // The UTC calendar, across a month and a year.
  assert.equal(trialEndFromSignup(new Date('2026-10-31T00:00:00.000Z')).toISOString(), '2026-11-13T23:59:59.999Z');
  assert.equal(trialEndFromSignup(new Date('2026-12-25T12:00:00.000Z')).toISOString(), '2027-01-07T23:59:59.999Z');
}

function testInvoicePaymentTerm() {
  // GTC art. 5.4: invoices paid by bank transfer are payable within 30 days.
  assert.equal(INVOICE_PAYMENT_TERM_DAYS, 30);
  // Every Stripe `days_until_due` reads the constant: no literal term left in the sources.
  const literal = /days_until_due\s*[:=]\s*\d/;
  const offenders = sourceFiles(backendPath('src')).filter((file) => literal.test(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(offenders, []);
}

/** A live subscription is never doubled; only one in good standing is changed. */
function testLiveAndHealthySubscriptions() {
  const now = Date.UTC(2026, 10, 11);
  const later = new Date(now + 86400000);
  const earlier = new Date(now - 86400000);
  for (const status of ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused']) {
    assert.equal(isLiveSubscriptionStatus(status), true, status);
  }
  for (const status of ['canceled', 'incomplete_expired', null, undefined, '']) {
    assert.equal(isLiveSubscriptionStatus(status), false, String(status));
  }
  assert.equal(isHealthySubscription('active', null, now), true);
  assert.equal(isHealthySubscription('trialing', later, now), true);
  assert.equal(isHealthySubscription('trialing', earlier, now), false);
  assert.equal(isHealthySubscription('trialing', null, now), false);
  for (const status of ['past_due', 'unpaid', 'incomplete', 'paused', 'canceled', 'incomplete_expired', null]) {
    assert.equal(isHealthySubscription(status, later, now), false, String(status));
  }
}

function run() {
  testSingleSellablePlan();
  testLiveAndHealthySubscriptions();
  testStoredPlanNameShowsTheCurrentName();
  testLegacyNameResolution();
  testPriceIdResolution();
  testBankTransferEligibility();
  testTrialEndsAtEndOfSignupDay();
  testInvoicePaymentTerm();
  // eslint-disable-next-line no-console
  console.log('plans.config.spec: all assertions passed');
}

run();
