import * as assert from 'node:assert/strict';
import { ensureInvoiceA4 } from '../stripe/invoice-a4';
import { describeStripeMode, stripeKeyMode, StripeClientService } from '../stripe';

/**
 * Invoice PDFs are A4 (Stripe's default is Letter). The helper sets the format on a draft
 * or an already paid invoice, skips one already in A4, and never blocks billing.
 * The Stripe mode (test or live) is logged at start-up and checked against the environment.
 */

const A4 = { rendering: { pdf: { page_size: 'a4' } } };

function createClient(error?: Error) {
  const updates: unknown[][] = [];
  const client = {
    invoices: {
      update: async (...args: unknown[]) => {
        updates.push(args);
        if (error) throw error;
        return { id: args[0], status: 'updated', ...A4 };
      },
    },
  };
  return { client, updates };
}

const silent = { warn: () => undefined };

async function testUpdatesADraftAndAPaidInvoice() {
  for (const invoice of [
    { id: 'in_draft', status: 'draft', rendering: { pdf: { page_size: 'letter' } } },
    { id: 'in_paid', status: 'paid', rendering: null },
    { id: 'in_bare', status: 'open' },
  ]) {
    const { client, updates } = createClient();
    const result = await ensureInvoiceA4(client, invoice, silent);
    assert.deepEqual(updates, [[invoice.id, A4]]);
    assert.equal(result.status, 'updated', 'the updated invoice is returned');
  }
}

async function testSkipsAnInvoiceAlreadyInA4() {
  const { client, updates } = createClient();
  const invoice = { id: 'in_a4', status: 'paid', ...A4 };
  assert.equal(await ensureInvoiceA4(client, invoice, silent), invoice);
  assert.deepEqual(updates, []);
}

async function testSkipsWithoutAnInvoiceOrClient() {
  const { client, updates } = createClient();
  assert.equal(await ensureInvoiceA4(client, null, silent), null);
  assert.equal(await ensureInvoiceA4(client, 'in_1', silent), 'in_1');
  const noId = { status: 'draft' };
  assert.equal(await ensureInvoiceA4(client, noId, silent), noId);
  const invoice = { id: 'in_1' };
  assert.equal(await ensureInvoiceA4(null, invoice, silent), invoice);
  assert.deepEqual(updates, []);
}

async function testSwallowsAStripeError() {
  const { client, updates } = createClient(new Error('This invoice can no longer be edited'));
  const warnings: string[] = [];
  const invoice = { id: 'in_void', status: 'void' };
  const result = await ensureInvoiceA4(client, invoice, { warn: (message: string) => warnings.push(message) });
  assert.equal(result, invoice, 'the input invoice is returned');
  assert.equal(updates.length, 1);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes('in_void') && warnings[0].includes('can no longer be edited'), warnings[0]);
}

function testStripeKeyMode() {
  assert.equal(stripeKeyMode('sk_test_abc'), 'test');
  assert.equal(stripeKeyMode('rk_test_abc'), 'test');
  assert.equal(stripeKeyMode('sk_live_abc'), 'live');
  assert.equal(stripeKeyMode('rk_live_abc'), 'live');
  assert.equal(stripeKeyMode('pk_live_abc'), 'unknown', 'a publishable key is not a secret key');
  assert.equal(stripeKeyMode('whsec_abc'), 'unknown');
  assert.equal(stripeKeyMode(''), 'unknown');
  assert.equal(stripeKeyMode(null), 'unknown');
}

function testModeLineAndMismatchWarning() {
  const api = '2025-09-30.clover';
  const testInDev = describeStripeMode('sk_test_secret123', api, { APP_ENV: 'development' });
  assert.equal(testInDev.line, '[stripe] mode=test api=2025-09-30.clover');
  assert.equal(testInDev.warning, null);

  const liveInProd = describeStripeMode('rk_live_secret123', api, { NODE_ENV: 'production' });
  assert.equal(liveInProd.line, '[stripe] mode=live api=2025-09-30.clover');
  assert.equal(liveInProd.warning, null);

  const testInProd = describeStripeMode('sk_test_secret123', api, { APP_ENV: 'prod' });
  assert.ok(testInProd.warning?.includes('test key in production'), String(testInProd.warning));

  for (const env of [{ APP_ENV: 'development' }, { APP_ENV: 'qa' }, {}]) {
    const liveOutsideProd = describeStripeMode('sk_live_secret123', api, env);
    assert.ok(liveOutsideProd.warning?.includes('live key in a non-production environment'), String(liveOutsideProd.warning));
  }

  for (const report of [testInDev, liveInProd, testInProd]) {
    assert.ok(!`${report.line} ${report.warning ?? ''}`.includes('secret123'), 'the key is never logged');
  }
}

function testStartupLogsOnce() {
  const logs: string[] = [];
  const warnings: string[] = [];
  const config = { isConfigured: () => true, getSecretKey: () => 'sk_test_secret123', getApiVersion: () => '2025-09-30.clover' };
  const service = new StripeClientService(config as any);
  (service as any).logger = { log: (m: string) => logs.push(m), warn: (m: string) => warnings.push(m) };
  service.onModuleInit();
  assert.deepEqual(logs, ['[stripe] mode=test api=2025-09-30.clover']);

  const unconfigured = new StripeClientService({ isConfigured: () => false } as any);
  (unconfigured as any).logger = { log: (m: string) => logs.push(m), warn: (m: string) => warnings.push(m) };
  unconfigured.onModuleInit();
  assert.equal(logs.length, 1, 'nothing is logged when Stripe is not configured');
}

async function run() {
  await testUpdatesADraftAndAPaidInvoice();
  await testSkipsAnInvoiceAlreadyInA4();
  await testSkipsWithoutAnInvoiceOrClient();
  await testSwallowsAStripeError();
  testStripeKeyMode();
  testModeLineAndMismatchWarning();
  testStartupLogsOnce();
}

void run();
