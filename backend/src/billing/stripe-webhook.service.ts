import { BadRequestException, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { StripeClientService, StripeConfigService } from './stripe';
import { Subscription, SubscriptionStatus, SubscriptionType, PaymentMode, CollectionMethod } from './subscription.entity';
import { computePriceAmount, normaliseStripePrice } from './price.util';
import { Tenant } from '../tenants/tenant.entity';
import { withTenant } from '../common/tenant-runner';
import { getEnvMode, isDevelopmentEnv } from '../common/env';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';
import {
  PLANS,
  resolvePlanKeyFromPriceId,
  resolvePlanKeyFromLegacyName,
  toPlanDisplayName,
  type PlanKey,
} from './plans.config';

type StripeEvent = any;

@Injectable()
export class StripeWebhookService implements OnModuleInit {
  private readonly logger = new Logger(StripeWebhookService.name);
  private hasLoggedRuntimeWebhookSecretAlert = false;

  constructor(
    private readonly config: StripeConfigService,
    private readonly stripeClient: StripeClientService,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    @Optional() private readonly emailService?: EmailService,
  ) {}

  onModuleInit(): void {
    this.logMissingWebhookSecretAlert('startup');
  }

  constructEvent(rawBody: Buffer, signature: string | undefined): StripeEvent {
    const client = this.stripeClient.getClient();
    const webhookSecret = this.config.getWebhookSecret();
    if (client && webhookSecret && signature) {
      try {
        return client.webhooks.constructEvent(rawBody, signature, webhookSecret);
      } catch (error) {
        this.logger.error(`Stripe signature verification failed: ${(error as Error).message}`);
        throw error;
      }
    }

    if (!this.allowInsecureWebhook()) {
      const missing: string[] = [];
      if (!client) missing.push('STRIPE_SECRET_KEY');
      if (!webhookSecret) missing.push('STRIPE_WEBHOOK_SECRET');
      if (!signature) missing.push('stripe-signature header');
      this.logMissingWebhookSecretAlert('request');
      throw new BadRequestException(
        `Stripe webhook signature verification required (missing: ${missing.join(', ')})`,
      );
    }
    this.logger.warn('Stripe webhook signature verification bypassed (development override)');

    try {
      const payload = rawBody.toString('utf8');
      return JSON.parse(payload);
    } catch (error) {
      this.logger.error('Unable to parse Stripe webhook payload as JSON');
      throw error;
    }
  }

  private allowInsecureWebhook(): boolean {
    if (!this.isDevelopmentEnv()) return false;
    const rawFlag = (process.env.STRIPE_WEBHOOK_ALLOW_INSECURE || '').trim().toLowerCase();
    return rawFlag === 'true' || rawFlag === '1' || rawFlag === 'yes';
  }

  private isDevelopmentEnv(): boolean {
    return isDevelopmentEnv();
  }

  private shouldAlertMissingWebhookSecret(): boolean {
    if (this.isDevelopmentEnv()) return false;
    // Stripe-disabled installs (no Stripe secret key) should not alert.
    if (!this.config.isConfigured()) return false;
    return !this.config.getWebhookSecret();
  }

  private logMissingWebhookSecretAlert(source: 'startup' | 'request'): void {
    if (!this.shouldAlertMissingWebhookSecret()) return;
    if (source === 'request' && this.hasLoggedRuntimeWebhookSecretAlert) return;
    const env = getEnvMode() || 'unknown';
    this.logger.error(
      `[SECURITY][STRIPE_WEBHOOK_SECRET_MISSING] Stripe billing is enabled but STRIPE_WEBHOOK_SECRET is missing in non-dev env "${env}" (${source}). Webhook requests will be rejected until the secret is configured.`,
    );
    if (source === 'request') {
      this.hasLoggedRuntimeWebhookSecretAlert = true;
    }
  }

  async processEvent(event: StripeEvent): Promise<void> {
    const identifiers = this.extractIdentifiers(event);
    await this.enrichIdentifiers(identifiers);
    if (!identifiers.customerId && !identifiers.subscriptionId) {
      this.logger.debug(`Skipping event ${event?.type || 'unknown'} without billing identifiers`);
      return;
    }

    const tenant = await this.lookupTenant(identifiers, event);
    if (!tenant) {
      // Check for enterprise support subscription
      const eventPriceId = event?.data?.object?.items?.data?.[0]?.price?.id
        ?? event?.data?.object?.plan?.id
        ?? null;
      const enterprisePriceId = (process.env.STRIPE_PRICE_ENTERPRISE_SUPPORT_ANNUAL || '').trim();
      if (enterprisePriceId && eventPriceId === enterprisePriceId) {
        this.logger.log(`Enterprise support subscription event received: ${event?.type} (${event?.id})`);
        const notifyEmail = (process.env.ENTERPRISE_SUPPORT_NOTIFY_EMAIL || '').trim();
        if (notifyEmail && this.emailService) {
          try {
            await this.emailService.send({
              to: notifyEmail,
              subject: `Enterprise Support Subscription Event: ${event?.type}`,
              html: `<p>Stripe event <strong>${event?.type}</strong> received for enterprise support subscription.</p><p>Event ID: ${event?.id}</p><p>Subscription ID: ${identifiers.subscriptionId ?? 'N/A'}</p>`,
            });
          } catch (emailError) {
            this.logger.warn(`Failed to send enterprise support notification email: ${(emailError as Error).message}`);
          }
        }
        return;
      }

      this.logger.warn(`Stripe event ${event?.id || 'unknown'} references unknown tenant`);
      return;
    }

    try {
      await this.applyEventToTenant(tenant.id, event, identifiers);
    } catch (error) {
      this.logger.error(`Failed to apply Stripe event for tenant ${tenant.id}: ${(error as Error).message}`);
      throw error;
    }
  }

  private extractIdentifiers(event: StripeEvent): { customerId?: string; subscriptionId?: string } {
    const data = event?.data?.object ?? {};
    const customerId = typeof data.customer === 'string' ? data.customer : typeof data.customer_id === 'string' ? data.customer_id : undefined;

    let subscriptionId: string | undefined;

    const assignSubscription = (candidate: any) => {
      if (typeof candidate === 'string' && candidate.startsWith('sub_')) {
        subscriptionId = candidate;
      } else if (candidate && typeof candidate.id === 'string' && candidate.id.startsWith('sub_')) {
        subscriptionId = candidate.id;
      }
    };

    assignSubscription(data.subscription);
    if (!subscriptionId && data.object === 'subscription') {
      assignSubscription(data.id);
    }
    if (!subscriptionId && event?.type?.startsWith('checkout.session.')) {
      assignSubscription(data.subscription);
    }
    if (!subscriptionId && (event?.type === 'payment_intent.succeeded' || event?.type === 'payment_intent.payment_failed')) {
      assignSubscription(data.metadata?.subscription_id);
    }
    if (!subscriptionId && event?.type?.startsWith('invoice.')) {
      assignSubscription(data.subscription);
    }

    return {
      customerId,
      subscriptionId,
    };
  }

  private async lookupTenant(
    identifiers: { customerId?: string; subscriptionId?: string },
    event?: StripeEvent,
  ): Promise<Tenant | null> {
    if (identifiers.customerId) {
      const tenant = await this.dataSource.getRepository(Tenant).findOne({ where: { stripe_customer_id: identifiers.customerId } });
      if (tenant) return tenant;
    }

    // The customer did not match: the tenant's stored customer id has drifted from the
    // customer that owns its subscription (billing recreates a customer it cannot retrieve).
    // `subscriptions` is under FORCE RLS and a webhook has no tenant, so it cannot be searched
    // across tenants; the `tenant_id` KANAP writes in the Stripe metadata says where to look.
    // The hint is only accepted when that tenant's own row carries this subscription id:
    // applying an event rewrites the tenant's subscription and customer, and a late event
    // from a subscription the tenant has left must not overwrite the live one.
    const hintedTenantId = this.tenantIdFromMetadata(event);
    if (identifiers.subscriptionId && hintedTenantId) {
      const owned: unknown[] = await withTenant(this.dataSource, hintedTenantId, (manager) =>
        manager.query(
          `SELECT 1 FROM subscriptions WHERE tenant_id = $1 AND stripe_subscription_id = $2 LIMIT 1`,
          [hintedTenantId, identifiers.subscriptionId],
        ),
      );
      if (owned.length > 0) {
        return this.dataSource.getRepository(Tenant).findOne({ where: { id: hintedTenantId } });
      }
    }

    return null;
  }

  /** `metadata.tenant_id` as written by BillingService on the customer, the subscription and the checkout session. */
  private tenantIdFromMetadata(event?: StripeEvent): string | undefined {
    const data = event?.data?.object ?? {};
    const candidates = [
      data.metadata?.tenant_id,
      data.subscription_details?.metadata?.tenant_id,
      data.parent?.subscription_details?.metadata?.tenant_id,
    ];
    return candidates.find(
      (value): value is string =>
        typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
    );
  }

  private async enrichIdentifiers(identifiers: { customerId?: string; subscriptionId?: string }): Promise<void> {
    if (identifiers.customerId || !identifiers.subscriptionId) return;
    const client = this.stripeClient.getClient();
    if (!client) return;
    try {
      const subscription = await client.subscriptions.retrieve(identifiers.subscriptionId, {
        expand: ['items.data.price.tiers'],
      });
      if (subscription && typeof subscription.customer === 'string') {
        identifiers.customerId = subscription.customer;
      }
    } catch (error) {
      this.logger.warn(`Unable to retrieve subscription ${identifiers.subscriptionId} from Stripe: ${(error as Error).message}`);
    }
  }

  private async applyEventToTenant(
    tenantId: string,
    event: StripeEvent,
    identifiers: { customerId?: string; subscriptionId?: string },
  ): Promise<void> {
    if (!identifiers.subscriptionId) {
      if (identifiers.customerId) {
        await this.updateTenantStripeCustomer(tenantId, identifiers.customerId);
      }
      return;
    }

    // Captured as a local: the guard's narrowing does not survive into the callback below.
    const subscriptionId = identifiers.subscriptionId;

    const subscriptionData = await this.resolveSubscriptionData(event, subscriptionId);
    const invoiceData = event?.type?.startsWith('invoice.') ? event?.data?.object ?? null : null;

    await withTenant(this.dataSource, tenantId, async (manager) => {
      const repo = manager.getRepository(Subscription);
      let sub = await repo.findOne({ where: { stripe_subscription_id: subscriptionId } });

      if (!sub) {
        sub = await repo.findOne({ where: {} });
      }
      const before = sub ? { ...sub } : null;

      if (!sub) {
        const initPlanKey = this.resolvePlanKey(subscriptionData, null);
        sub = repo.create({
          plan_name: initPlanKey ? toPlanDisplayName(initPlanKey) : (subscriptionData?.plan?.nickname ?? null),
          seat_limit: initPlanKey ? PLANS[initPlanKey].seatLimit : null,
          subscription_type: this.resolveSubscriptionType(subscriptionData?.items?.data?.[0]?.price),
          payment_mode: this.resolvePaymentMode(subscriptionData),
        });
      }

      if (identifiers.customerId) {
        sub.stripe_customer_id = identifiers.customerId;
      }
      sub.stripe_subscription_id = subscriptionId;
      if (subscriptionData) {
        sub.status = this.resolveStatus(subscriptionData?.status) ?? sub.status ?? null;
        sub.collection_method = this.resolveCollectionMethod(subscriptionData?.collection_method) ?? sub.collection_method ?? null;
        sub.current_period_start = this.toDate(subscriptionData?.current_period_start);
        sub.current_period_end = this.toDate(subscriptionData?.current_period_end);
        sub.trial_end = this.toDate(subscriptionData?.trial_end);
        sub.cancel_at = this.toDate(subscriptionData?.cancel_at);
        sub.canceled_at = this.toDate(subscriptionData?.canceled_at);
        sub.canceled_at_effective = subscriptionData?.cancel_at_period_end ? this.toDate(subscriptionData?.current_period_end) : null;
        sub.next_payment_at = this.toDate(subscriptionData?.current_period_end);
        sub.currency = typeof subscriptionData?.currency === 'string' ? subscriptionData.currency?.toUpperCase() : sub.currency ?? null;
        sub.amount = this.resolveAmount(subscriptionData);
        if (!sub.currency) {
          const priceCurrency = subscriptionData?.items?.data?.[0]?.price?.currency;
          if (priceCurrency) {
            sub.currency = String(priceCurrency).toUpperCase();
          }
        }
        sub.stripe_product_id = subscriptionData?.items?.data?.[0]?.price?.product ?? sub.stripe_product_id ?? null;
        sub.stripe_price_id = subscriptionData?.items?.data?.[0]?.price?.id ?? sub.stripe_price_id ?? null;
        sub.days_until_due = typeof subscriptionData?.days_until_due === 'number' ? subscriptionData.days_until_due : sub.days_until_due ?? null;

        // Plan resolution: metadata → price ID → legacy name fallback
        const resolvedPlanKey = this.resolvePlanKey(subscriptionData, sub.plan_name);
        if (resolvedPlanKey) {
          sub.plan_name = toPlanDisplayName(resolvedPlanKey);
          sub.seat_limit = PLANS[resolvedPlanKey].seatLimit;
        } else {
          const planName = subscriptionData?.plan?.nickname ?? null;
          // The Stripe quantity is not a number of users: keep the stored user limit.
          sub.plan_name = planName ?? sub.plan_name ?? null;
        }
        if (typeof subscriptionData?.quantity === 'number') {
          sub.active_seats = subscriptionData.quantity;
        }
        const interval = subscriptionData?.items?.data?.[0]?.price?.recurring?.interval;
        if (interval === 'year') {
          sub.subscription_type = SubscriptionType.ANNUAL;
        } else if (interval === 'month') {
          sub.subscription_type = SubscriptionType.MONTHLY;
        }

        const paymentMethodInfo = await this.describePaymentMethod(subscriptionData?.default_payment_method);
        if (paymentMethodInfo) {
          sub.default_payment_method_id = paymentMethodInfo.id;
          sub.default_payment_method_brand = paymentMethodInfo.brand;
          sub.default_payment_method_last4 = paymentMethodInfo.last4;
        }
      }

      if (invoiceData) {
        const invoice = invoiceData;
        sub.latest_invoice_id = invoice.id ?? sub.latest_invoice_id ?? null;
        sub.latest_invoice_status = invoice.status ?? sub.latest_invoice_status ?? null;
        sub.latest_invoice_number = invoice.number ?? sub.latest_invoice_number ?? null;
        sub.latest_invoice_url = invoice.hosted_invoice_url ?? sub.latest_invoice_url ?? null;
        sub.latest_invoice_pdf = invoice.invoice_pdf ?? sub.latest_invoice_pdf ?? null;
        sub.last_payment_error_code = invoice.last_payment_error?.code ?? null;
        sub.last_payment_error_message = invoice.last_payment_error?.message ?? null;
        if (typeof invoice.total === 'number') {
          sub.latest_invoice_amount = invoice.total;
        }
        if (invoice.currency) {
          sub.latest_invoice_currency = invoice.currency.toUpperCase();
        }
        if (invoice.created) {
          sub.latest_invoice_created = this.toDate(invoice.created);
        }
        if (!sub.currency && invoice.currency) {
          sub.currency = invoice.currency.toUpperCase();
        }
        if (!sub.amount && typeof invoice.total === 'number') {
          sub.amount = invoice.total;
        }
        if (!sub.next_payment_at) {
          sub.next_payment_at = this.toDate(invoice.next_payment_attempt);
        }
      }

      sub.last_synced_at = new Date();
      const saved = await repo.save(sub);
      await this.audit.log(
        {
          table: 'subscriptions',
          recordId: saved.id,
          action: before ? 'update' : 'create',
          before,
          after: { ...saved },
          userId: null,
          source: 'webhook',
          sourceRef: event?.id ? String(event.id) : null,
        },
        { manager },
      );
    });

    if (identifiers.customerId) {
      await this.updateTenantStripeCustomer(tenantId, identifiers.customerId);
    }
  }

  private async updateTenantStripeCustomer(tenantId: string, customerId: string): Promise<void> {
    const tenantRepo = this.dataSource.getRepository(Tenant);
    const tenant = await tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) return;
    if (tenant.stripe_customer_id === customerId) return;
    await tenantRepo.update({ id: tenantId }, { stripe_customer_id: customerId });
  }

  private resolveSubscriptionType(price: any): SubscriptionType {
    const interval = price?.recurring?.interval;
    if (interval === 'year') return SubscriptionType.ANNUAL;
    return SubscriptionType.MONTHLY;
  }

  private resolvePaymentMode(subObject: any): PaymentMode {
    const collectionMethod = subObject?.collection_method;
    if (collectionMethod === 'send_invoice') return PaymentMode.BANK_TRANSFER;
    return PaymentMode.CARD;
  }

  private resolveStatus(status: any): SubscriptionStatus | null {
    if (typeof status !== 'string') return null;
    switch (status) {
      case 'incomplete':
        return SubscriptionStatus.INCOMPLETE;
      case 'incomplete_expired':
        return SubscriptionStatus.INCOMPLETE_EXPIRED;
      case 'trialing':
        return SubscriptionStatus.TRIALING;
      case 'active':
        return SubscriptionStatus.ACTIVE;
      case 'past_due':
        return SubscriptionStatus.PAST_DUE;
      case 'canceled':
        return SubscriptionStatus.CANCELED;
      case 'unpaid':
        return SubscriptionStatus.UNPAID;
      case 'paused':
        return SubscriptionStatus.PAUSED;
      default:
        return null;
    }
  }

  private resolveCollectionMethod(collectionMethod: any): CollectionMethod | null {
    if (collectionMethod === 'charge_automatically') return CollectionMethod.CHARGE_AUTOMATICALLY;
    if (collectionMethod === 'send_invoice') return CollectionMethod.SEND_INVOICE;
    return null;
  }

  private resolveAmount(subObject: any): number | null {
    const price = subObject?.items?.data?.[0]?.price;
    const quantity = this.resolveQuantity(subObject);
    const normalised = normaliseStripePrice(price);
    if (normalised) {
      const amount = computePriceAmount(normalised, quantity);
      if (amount != null) {
        return amount;
      }
    }
    if (typeof subObject?.amount_due === 'number') {
      return subObject.amount_due;
    }
    if (typeof subObject?.plan?.amount === 'number') {
      return subObject.plan.amount * quantity;
    }
    if (price?.unit_amount != null) {
      return price.unit_amount * quantity;
    }
    return null;
  }

  private resolvePlanKey(subscriptionData: any, existingPlanName: string | null | undefined): PlanKey | null {
    // Priority 1: metadata.plan_key
    const metadataPlanKey = subscriptionData?.metadata?.plan_key;
    if (metadataPlanKey && metadataPlanKey in PLANS) {
      return metadataPlanKey as PlanKey;
    }
    // Priority 2: resolve from price ID
    const stripePriceId = subscriptionData?.items?.data?.[0]?.price?.id;
    if (stripePriceId) {
      const fromPrice = resolvePlanKeyFromPriceId(stripePriceId);
      if (fromPrice) return fromPrice;
    }
    // Priority 3: legacy name fallback
    const fromLegacy = resolvePlanKeyFromLegacyName(existingPlanName);
    if (fromLegacy) return fromLegacy;
    return null;
  }

  private resolveQuantity(subObject: any): number {
    if (typeof subObject?.quantity === 'number' && subObject.quantity > 0) return subObject.quantity;
    const itemQuantity = subObject?.items?.data?.[0]?.quantity;
    if (typeof itemQuantity === 'number' && itemQuantity > 0) return itemQuantity;
    return 1;
  }

  private toDate(value: any): Date | null {
    if (!value) return null;
    if (typeof value === 'number') {
      return new Date(value * 1000);
    }
    if (typeof value === 'string') {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }

  private async resolveSubscriptionData(event: StripeEvent, subscriptionId?: string): Promise<any | null> {
    if (event?.type?.startsWith('customer.subscription.')) {
      return event?.data?.object ?? null;
    }
    if (event?.type === 'checkout.session.completed' && event?.data?.object?.subscription) {
      const subscription = event.data.object.subscription;
      if (typeof subscription === 'object' && subscription !== null) {
        return subscription;
      }
      if (typeof subscription === 'string') {
        try {
          const client = this.stripeClient.getClient();
          if (client) {
            return await client.subscriptions.retrieve(subscription, {
              expand: ['items.data.price.tiers'],
            });
          }
        } catch (error) {
          this.logger.warn(`Unable to retrieve subscription ${subscription} from checkout session: ${(error as Error).message}`);
        }
      }
    }
    if (!subscriptionId) return null;
    const client = this.stripeClient.getClient();
    if (!client) return null;
    try {
      return await client.subscriptions.retrieve(subscriptionId, {
        expand: ['items.data.price.tiers'],
      });
    } catch (error) {
      this.logger.warn(`Unable to retrieve subscription ${subscriptionId} for sync: ${(error as Error).message}`);
      return null;
    }
  }

  private async retrievePaymentMethod(paymentMethodId: string): Promise<any | null> {
    const client = this.stripeClient.getClient();
    if (!client) return null;
    try {
      return await client.paymentMethods.retrieve(paymentMethodId);
    } catch (error) {
      this.logger.warn(`Unable to retrieve payment method ${paymentMethodId}: ${(error as Error).message}`);
      return null;
    }
  }

  private async describePaymentMethod(source: any): Promise<{ id: string; brand: string | null; last4: string | null } | null> {
    if (!source) return null;
    let paymentMethod: any = source;
    if (typeof source === 'string') {
      paymentMethod = await this.retrievePaymentMethod(source);
    }
    if (!paymentMethod || typeof paymentMethod !== 'object') {
      return typeof source === 'string'
        ? { id: source, brand: null, last4: null }
        : null;
    }
    const id = typeof source === 'string' ? source : paymentMethod.id ?? null;
    if (!id) return null;
    const info = this.extractPaymentMethodInfo(paymentMethod);
    return {
      id,
      brand: info.brand,
      last4: info.last4,
    };
  }

  private extractPaymentMethodInfo(paymentMethod: any): { brand: string | null; last4: string | null } {
    if (!paymentMethod || typeof paymentMethod !== 'object') {
      return { brand: null, last4: null };
    }
    if (paymentMethod.card) {
      return {
        brand: paymentMethod.card.brand ? String(paymentMethod.card.brand).toUpperCase() : null,
        last4: paymentMethod.card.last4 ?? null,
      };
    }
    if (paymentMethod.sepa_debit) {
      return {
        brand: 'SEPA',
        last4: paymentMethod.sepa_debit.last4 ?? null,
      };
    }
    if (paymentMethod.type && paymentMethod[paymentMethod.type]?.last4) {
      return {
        brand: String(paymentMethod.type).toUpperCase(),
        last4: paymentMethod[paymentMethod.type].last4,
      };
    }
    if (paymentMethod.type) {
      return {
        brand: String(paymentMethod.type).toUpperCase(),
        last4: null,
      };
    }
    return { brand: null, last4: null };
  }
}
