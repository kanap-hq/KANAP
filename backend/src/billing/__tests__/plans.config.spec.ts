import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { backendPath } from '../../common/__tests__/backend-root';
import {
  INVOICE_PAYMENT_TERM_DAYS,
  PLANS,
  isBankTransferEligible,
  resolvePlanKeyFromLegacyName,
  resolvePlanKeyFromPriceId,
  toPlanDisplayName,
} from '../plans.config';

function testSingleSellablePlan() {
  const keys = Object.keys(PLANS);
  assert.deepEqual(keys, ['max']);
  const plan = PLANS.max;
  assert.equal(plan.displayName, 'Hosted KANAP');
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
  assert.equal(toPlanDisplayName('max'), 'Hosted KANAP');
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

function testInvoicePaymentTerm() {
  // GTC art. 5.4: invoices paid by bank transfer are payable within 30 days.
  assert.equal(INVOICE_PAYMENT_TERM_DAYS, 30);
  // Every Stripe `days_until_due` reads the constant: no literal term left in the sources.
  const literal = /days_until_due\s*[:=]\s*\d/;
  const offenders = sourceFiles(backendPath('src')).filter((file) => literal.test(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(offenders, []);
}

function run() {
  testSingleSellablePlan();
  testLegacyNameResolution();
  testPriceIdResolution();
  testBankTransferEligibility();
  testInvoicePaymentTerm();
  // eslint-disable-next-line no-console
  console.log('plans.config.spec: all assertions passed');
}

run();
