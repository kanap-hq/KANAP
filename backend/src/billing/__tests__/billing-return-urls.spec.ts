import * as assert from 'node:assert/strict';
import { Features } from '../../config/features';
import { BillingController } from '../billing.controller';
import { requestHost, sameHostReturnUrl } from '../return-url';

/**
 * Stripe sends the customer to the return URLs a client gives (checkout, card setup for a plan
 * change, portal). A URL on another host, or not over https outside local development, would
 * make KANAP an open redirect: it is ignored and the configured URL applies.
 */

const TENANT_HOST = 'fromage.kanap.net';

function testHelperKeepsOnlyTheRequestHost() {
  assert.equal(sameHostReturnUrl('https://fromage.kanap.net/admin/billing', TENANT_HOST), 'https://fromage.kanap.net/admin/billing');
  // Kept as sent: a Stripe template in the query is not encoded.
  assert.equal(
    sameHostReturnUrl('https://fromage.kanap.net/admin/billing?session={CHECKOUT_SESSION_ID}', TENANT_HOST),
    'https://fromage.kanap.net/admin/billing?session={CHECKOUT_SESSION_ID}',
  );
  for (const foreign of [
    'https://evil.example/admin/billing',
    'https://other.kanap.net/admin/billing',
    'https://fromage.kanap.net.evil.example/',
    'https://fromage.kanap.net@evil.example/',
    'https://evil.example\\@fromage.kanap.net/',
    '//evil.example/admin/billing',
    '/admin/billing',
    'not a url',
    '',
  ]) {
    assert.equal(sameHostReturnUrl(foreign, TENANT_HOST), null, foreign);
  }
  for (const badProtocol of ['http://fromage.kanap.net/admin/billing', 'javascript:alert(1)', 'ftp://fromage.kanap.net/']) {
    assert.equal(sameHostReturnUrl(badProtocol, TENANT_HOST), null, badProtocol);
  }
  // Plain http only on a local development host.
  assert.equal(sameHostReturnUrl('http://fromage.lvh.me/admin/billing', 'fromage.lvh.me'), 'http://fromage.lvh.me/admin/billing');
  assert.equal(sameHostReturnUrl('http://fromage.localhost:5173/admin/billing', 'fromage.localhost'), 'http://fromage.localhost:5173/admin/billing');
  assert.equal(sameHostReturnUrl('http://localhost/admin/billing', 'localhost'), 'http://localhost/admin/billing');
  assert.equal(sameHostReturnUrl(undefined, TENANT_HOST), null);
  assert.equal(sameHostReturnUrl('https://fromage.kanap.net/', ''), null);
  // The host as tenant resolution reads it.
  assert.equal(requestHost({ headers: { host: 'Fromage.Kanap.net:443' } }), TENANT_HOST);
}

function request(host: string) {
  return { headers: { host }, tenant: { id: 'tenant-1' }, user: { sub: 'user-1' }, queryRunner: { manager: {} } };
}

const CASES: Array<{ url: string; host: string; kept: boolean; label: string }> = [
  { url: 'https://evil.example/admin/billing', host: TENANT_HOST, kept: false, label: 'foreign host' },
  { url: 'https://fromage.kanap.net/admin/billing', host: TENANT_HOST, kept: true, label: 'same host' },
  { url: 'http://fromage.kanap.net/admin/billing', host: TENANT_HOST, kept: false, label: 'http outside local development' },
  { url: 'javascript:alert(1)', host: TENANT_HOST, kept: false, label: 'bad protocol' },
  { url: 'http://fromage.lvh.me/admin/billing', host: 'fromage.lvh.me', kept: true, label: 'http on a local host' },
];

async function withBilling(run: () => Promise<void>) {
  const previous = Features.STRIPE_BILLING;
  (Features as any).STRIPE_BILLING = true;
  try {
    await run();
  } finally {
    (Features as any).STRIPE_BILLING = previous;
  }
}

async function testCheckoutIgnoresForeignReturnUrls() {
  for (const { url, host, kept, label } of CASES) {
    let received: Record<string, unknown> | null = null;
    const controller = new BillingController({
      createCheckoutSession: async (opts: Record<string, unknown>) => {
        received = opts;
        return { url: 'https://checkout.stripe.test/cs_1', id: 'cs_1' };
      },
    } as any);
    await controller.createCheckout(request(host), { plan_key: 'max', interval: 'monthly', success_url: url, cancel_url: url } as any);
    assert.equal(received!.successUrl, kept ? url : null, `checkout success_url, ${label}`);
    assert.equal(received!.cancelUrl, kept ? url : null, `checkout cancel_url, ${label}`);
  }
}

async function testChangePlanIgnoresForeignReturnUrls() {
  for (const { url, host, kept, label } of CASES) {
    let received: unknown[] | null = null;
    const controller = new BillingController({
      changePlan: async (...args: unknown[]) => {
        received = args;
        return {};
      },
    } as any);
    await controller.changePlan(request(host), { plan_key: 'max', subscription_type: 'monthly', success_url: url, cancel_url: url } as any);
    assert.deepEqual(received![6], kept ? { successUrl: url, cancelUrl: url } : { successUrl: null, cancelUrl: null }, `change-plan, ${label}`);
  }
}

async function testPortalIgnoresAForeignReturnUrl() {
  for (const { url, host, kept, label } of CASES) {
    let received: Record<string, unknown> | null = null;
    const controller = new BillingController({
      createCustomerPortalSession: async (opts: Record<string, unknown>) => {
        received = opts;
        return { url: 'https://billing.stripe.test/p_1', id: 'p_1' };
      },
    } as any);
    await controller.openPortal(request(host), { returnUrl: url } as any);
    assert.equal(received!.returnUrl, kept ? url : null, `portal, ${label}`);
  }
}

async function run() {
  testHelperKeepsOnlyTheRequestHost();
  await withBilling(async () => {
    await testCheckoutIgnoresForeignReturnUrls();
    await testChangePlanIgnoresForeignReturnUrls();
    await testPortalIgnoresAForeignReturnUrl();
  });
  // eslint-disable-next-line no-console
  console.log('billing-return-urls.spec: ok');
}

void run();
