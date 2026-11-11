import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import { withTenant } from '../../common/tenant-runner';
import { StripeWebhookService } from '../stripe-webhook.service';

// Stripe sends the events of one invoice close together (`invoice.paid` and `invoice.finalized`
// 640 ms apart were seen on dev), and the API may handle them at the same time. The events of a
// tenant are handled one after the other: the second one reads what the first one wrote, so the
// latest invoice ends `paid` whatever the order. Against a real database; the tenant is removed
// at the end.

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function seedTenant(tag: string) {
  const tenantId = randomUUID();
  const customerId = `cus_spec_${tenantId.slice(0, 8)}`;
  const subscriptionId = `sub_spec_${tenantId.slice(0, 8)}`;
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, stripe_customer_id, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `webhook-serial-${tag}-${tenantId.slice(0, 8)}`, `Webhook serialization ${tag}`, customerId],
  );
  await withTenant(dataSource, tenantId, (manager) =>
    manager.query(
      `INSERT INTO subscriptions (tenant_id, status, stripe_subscription_id, stripe_customer_id, plan_name, seat_limit, active_seats)
       VALUES ($1, 'active', $2, $3, 'Kadratis Cloud', NULL, 1)`,
      [tenantId, subscriptionId, customerId],
    ),
  ).catch(async (error) => {
    await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    throw error;
  });
  return { tenantId, customerId, subscriptionId };
}

async function removeTenant(tenantId: string) {
  await withTenant(dataSource, tenantId, (manager) => manager.query(`DELETE FROM subscriptions WHERE tenant_id = $1`, [tenantId]));
  await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
}

async function latestInvoiceStatus(tenantId: string): Promise<string | null> {
  const rows = await withTenant(dataSource, tenantId, (manager) =>
    manager.query(`SELECT latest_invoice_status FROM subscriptions WHERE tenant_id = $1`, [tenantId]),
  );
  return rows[0]?.latest_invoice_status ?? null;
}

/**
 * Handles `first`, holds it inside its transaction (at its audit entry, after its write), starts
 * `second`, then lets `first` commit. Returns the stored status of the invoice.
 */
async function handleTogether(first: 'paid' | 'open', second: 'paid' | 'open'): Promise<string | null> {
  const { tenantId, customerId, subscriptionId } = await seedTenant(`${first}-${second}`);
  try {
    const invoiceId = `in_spec_${tenantId.slice(0, 8)}`;
    const client = {
      subscriptions: {
        retrieve: async () => ({
          object: 'subscription',
          id: subscriptionId,
          customer: customerId,
          status: 'active',
          collection_method: 'charge_automatically',
          currency: 'eur',
          latest_invoice: invoiceId,
          default_payment_method: 'pm_spec',
          items: { data: [{ quantity: 1, price: { id: 'price_spec', currency: 'eur', unit_amount: 24900, recurring: { interval: 'month' } } }] },
        }),
      },
      paymentMethods: { retrieve: async (id: string) => ({ id, type: 'card', card: { brand: 'visa', last4: '4242' } }) },
      invoices: { update: async (id: string) => ({ id }) },
    };
    const firstInsideItsTransaction = deferred();
    const letFirstCommit = deferred();
    let audits = 0;
    const audit = {
      log: async () => {
        audits += 1;
        if (audits !== 1) return;
        firstInsideItsTransaction.resolve();
        await letFirstCommit.promise;
      },
    };
    const svc = new StripeWebhookService({} as any, { getClient: () => client } as any, dataSource, audit as any);
    (svc as any).logger = { warn: () => undefined, log: () => undefined, debug: () => undefined, error: () => undefined };

    const event = (status: 'paid' | 'open') => ({
      id: `evt_${status}`,
      type: status === 'paid' ? 'invoice.paid' : 'invoice.finalized',
      data: {
        object: {
          object: 'invoice',
          id: invoiceId,
          customer: customerId,
          subscription: subscriptionId,
          status,
          number: 'KAN-0046',
          total: 24900,
          currency: 'eur',
          created: 1_792_000_000,
          rendering: { pdf: { page_size: 'a4' } },
        },
      },
    });

    const firstDone = svc.processEvent(event(first));
    await firstInsideItsTransaction.promise;
    const secondDone = svc.processEvent(event(second));
    // The second event reaches its own transaction while the first one has not committed.
    await delay(300);
    letFirstCommit.resolve();
    await Promise.all([firstDone, secondDone]);
    return await latestInvoiceStatus(tenantId);
  } finally {
    await removeTenant(tenantId);
  }
}

async function main() {
  await dataSource.initialize();
  try {
    assert.equal(await handleTogether('paid', 'open'), 'paid', 'a finalized event handled with the paid one does not reopen the invoice');
    assert.equal(await handleTogether('open', 'paid'), 'paid', 'the paid event handled with the finalized one ends paid');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
