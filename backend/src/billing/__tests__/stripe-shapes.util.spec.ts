import * as assert from 'node:assert/strict';
import { invoiceSubscriptionId, subscriptionPeriod, subscriptionQuantity } from '../stripe/stripe-shapes.util';

/**
 * Stripe moved fields KANAP reads in 2025-03-31.basil: the subscription period went to
 * the subscription items, and an invoice names its subscription under `parent`. The
 * client and the webhook endpoint may run different versions, so both shapes are read.
 */

const START = 1_790_000_000;
const END = 1_792_592_000;

function testPeriodTopLevel() {
  // 2023-10-16: the period is on the subscription.
  assert.deepEqual(
    subscriptionPeriod({ current_period_start: START, current_period_end: END, items: { data: [] } }),
    { start: START, end: END },
  );
}

function testPeriodFromTheItems() {
  // 2025-09-30.clover: absent at the top level, present on each item.
  assert.deepEqual(
    subscriptionPeriod({ items: { data: [{ current_period_start: START, current_period_end: END }] } }),
    { start: START, end: END },
  );
  // Several items: the period that ends first.
  assert.deepEqual(
    subscriptionPeriod({
      items: {
        data: [
          { current_period_start: START, current_period_end: END + 86400 },
          { current_period_start: START + 10, current_period_end: END },
          { current_period_start: START },
        ],
      },
    }),
    { start: START + 10, end: END },
  );
}

function testPeriodMissing() {
  const none = { start: null, end: null };
  assert.deepEqual(subscriptionPeriod(null), none);
  assert.deepEqual(subscriptionPeriod({}), none);
  assert.deepEqual(subscriptionPeriod({ current_period_end: null, items: { data: [{ id: 'si_1' }] } }), none);
}

function testInvoiceSubscriptionLegacy() {
  assert.equal(invoiceSubscriptionId({ subscription: 'sub_1' }), 'sub_1');
  assert.equal(invoiceSubscriptionId({ subscription: { id: 'sub_1', object: 'subscription' } }), 'sub_1');
}

function testInvoiceSubscriptionFromParent() {
  assert.equal(
    invoiceSubscriptionId({ parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_2' } } }),
    'sub_2',
  );
  assert.equal(
    invoiceSubscriptionId({ parent: { subscription_details: { subscription: { id: 'sub_2' } } } }),
    'sub_2',
  );
  // No invoice parent: the first line names the subscription item's subscription.
  assert.equal(
    invoiceSubscriptionId({
      parent: null,
      lines: { data: [{ parent: { type: 'subscription_item_details', subscription_item_details: { subscription: 'sub_3' } } }] },
    }),
    'sub_3',
  );
}

function testInvoiceSubscriptionMissing() {
  assert.equal(invoiceSubscriptionId(null), null);
  assert.equal(invoiceSubscriptionId({}), null);
  assert.equal(invoiceSubscriptionId({ subscription: null, parent: { quote_details: { quote: 'qt_1' } } }), null);
}

function testQuantity() {
  assert.equal(subscriptionQuantity({ quantity: 3, items: { data: [{ quantity: 1 }] } }), 3);
  assert.equal(subscriptionQuantity({ items: { data: [{ quantity: 2 }] } }), 2);
  assert.equal(subscriptionQuantity({ quantity: null, items: { data: [{ quantity: 2 }] } }), 2);
  assert.equal(subscriptionQuantity({}), null);
  assert.equal(subscriptionQuantity(undefined), null);
}

function run() {
  testPeriodTopLevel();
  testPeriodFromTheItems();
  testPeriodMissing();
  testInvoiceSubscriptionLegacy();
  testInvoiceSubscriptionFromParent();
  testInvoiceSubscriptionMissing();
  testQuantity();
  // eslint-disable-next-line no-console
  console.log('stripe-shapes.util.spec: all assertions passed');
}

run();
