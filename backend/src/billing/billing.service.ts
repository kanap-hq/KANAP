import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, DataSource } from 'typeorm';
import { PaymentMode, Subscription, SubscriptionType, SubscriptionStatus, CollectionMethod } from './subscription.entity';
import { User } from '../users/user.entity';
import { Tenant } from '../tenants/tenant.entity';
import { StripeClientService, StripeConfigService } from './stripe';
import { computePriceAmount, computeStripePriceAmount, normaliseStripePrice, type NormalisedPrice } from './price.util';
import { euVatTaxIdValue, missingInvoiceFields, normaliseVatNumber, toIsoCountry } from './billing-profile.util';
import { withTenant } from '../common/tenant-runner';
import { Features } from '../config/features';
import { AuditService } from '../audit/audit.service';
import {
  PLANS,
  HEALTHY_STATUSES,
  FREEZE_GRACE_DAYS,
  BANK_TRANSFER_MIN_AMOUNT_EUR_CENTS,
  CLOUD_SUBSCRIPTION_QUANTITY,
  getPriceId,
  isBankTransferEligible,
  resolvePlanKeyFromPriceId,
  resolvePlanKeyFromLegacyName,
  toPlanDisplayName,
  type PlanKey,
  type IntervalKey,
} from './plans.config';

const STRIPE_EU_BANK_TRANSFER_COUNTRIES = new Set<string>(['BE', 'DE', 'ES', 'FR', 'IE', 'NL']);
const STRIPE_DEFAULT_EU_BANK_TRANSFER_COUNTRY = 'FR';

type BillingAddress = {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
};

type BillingContact = {
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  vatNumber: string | null;
  address: BillingAddress;
};

const EMPTY_CONTACT: Readonly<BillingContact> = Object.freeze({
  name: null,
  company: null,
  email: null,
  phone: null,
  vatNumber: null,
  address: Object.freeze({ line1: null, line2: null, city: null, state: null, postalCode: null, country: null }),
});

type BillingAddressInput = Partial<Omit<BillingAddress, 'postalCode'>> & { postalCode?: string | null };

type BillingContactInput = {
  name?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  vatNumber?: string | null;
  address?: BillingAddressInput | null;
};

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly priceCache = new Map<string, NormalisedPrice>();

  constructor(
    @InjectRepository(Subscription)
    private readonly subs: Repository<Subscription>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    private readonly stripeClient: StripeClientService,
    private readonly stripeConfig: StripeConfigService,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  private subscriptionAuditSnapshot(sub: Subscription | null) {
    if (!sub) return null;
    return { ...sub };
  }

  private tenantBillingSnapshot(tenant: Tenant | null) {
    if (!tenant) return null;
    return {
      id: tenant.id,
      billing_customer_info: tenant.billing_customer_info ?? null,
      billing_invoice_info: tenant.billing_invoice_info ?? null,
      billing_email: tenant.billing_email ?? null,
      billing_company_name: tenant.billing_company_name ?? null,
      billing_phone: tenant.billing_phone ?? null,
      billing_tax_id: tenant.billing_tax_id ?? null,
      billing_address: tenant.billing_address ?? null,
      stripe_customer_id: tenant.stripe_customer_id ?? null,
    };
  }

  async getPlans() {
    return Object.values(PLANS).map(plan => ({
      plan_key: plan.key,
      display_name: plan.displayName,
      seat_limit: plan.seatLimit,
      invoice_eligible: plan.invoiceEligible,
      bank_transfer_min_amount: BANK_TRANSFER_MIN_AMOUNT_EUR_CENTS,
      payment_options: {
        monthly: {
          card: true,
          bank_transfer: isBankTransferEligible(plan.key, 'monthly'),
        },
        annual: {
          card: true,
          bank_transfer: isBankTransferEligible(plan.key, 'annual'),
        },
      },
      prices: plan.prices,
    }));
  }

  async getSubscriptionSummary(opts?: { manager?: EntityManager; forceStripeRefresh?: boolean }) {
    const mg = opts?.manager ?? this.subs.manager;
    let sub = await this.ensureSubscription(mg);
    const shouldRefresh = opts?.forceStripeRefresh
      ? !!sub.stripe_subscription_id
      : await this.shouldRefreshFromStripe(sub);
    if (shouldRefresh) {
      sub = await this.refreshSubscriptionFromStripe(sub, mg).catch((error) => {
        this.logger.warn(`Stripe refresh failed for subscription ${sub.id}: ${(error as Error).message}`);
        return sub;
      });
    }
    const seats_used = await this.computeSeatsUsed(mg);
    const estimated = await this.estimateRecurringAmount(sub);
    const amount = sub.amount ?? estimated?.amount ?? null;
    const currency = sub.currency ?? estimated?.currency ?? null;

    const now = Date.now();
    const statusStr = sub.status ?? '';
    const isHealthy =
      (HEALTHY_STATUSES as readonly string[]).includes(statusStr) &&
      (statusStr !== 'trialing' || (sub.trial_end != null && sub.trial_end.getTime() > now));

    let trialDaysRemaining: number | null = null;
    if (statusStr === 'trialing' && sub.trial_end) {
      trialDaysRemaining = Math.max(0, Math.ceil((sub.trial_end.getTime() - now) / 86400000));
    }

    let paymentDueAt: string | null = null;
    if (sub.collection_method === CollectionMethod.CHARGE_AUTOMATICALLY && sub.current_period_end) {
      paymentDueAt = sub.current_period_end.toISOString();
    } else if (sub.collection_method === CollectionMethod.SEND_INVOICE && sub.latest_invoice_created && sub.days_until_due) {
      const dueMs = sub.latest_invoice_created.getTime() + sub.days_until_due * 86400000;
      paymentDueAt = new Date(dueMs).toISOString();
    }

    let freezeEffectiveAt: string | null = null;
    if (paymentDueAt) {
      const freezeMs = new Date(paymentDueAt).getTime() + FREEZE_GRACE_DAYS * 86400000;
      freezeEffectiveAt = new Date(freezeMs).toISOString();
    }
    const renewalAt = sub.current_period_end
      ? sub.current_period_end.toISOString()
      : (sub.next_payment_at ? sub.next_payment_at.toISOString() : paymentDueAt);

    return {
      plan_name: sub.plan_name,
      seat_limit: sub.seat_limit,
      seats_used,
      subscription_type: sub.subscription_type,
      payment_mode: sub.payment_mode,
      active_seats: sub.active_seats,
      next_payment_at: sub.next_payment_at ? sub.next_payment_at.toISOString() : null,
      renewal_at: renewalAt,
      status: sub.status,
      collection_method: sub.collection_method,
      current_period_start: sub.current_period_start ? sub.current_period_start.toISOString() : null,
      current_period_end: sub.current_period_end ? sub.current_period_end.toISOString() : null,
      trial_end: sub.trial_end ? sub.trial_end.toISOString() : null,
      cancel_at: sub.cancel_at ? sub.cancel_at.toISOString() : null,
      canceled_at: sub.canceled_at ? sub.canceled_at.toISOString() : null,
      currency,
      amount,
      amount_currency: currency,
      estimated_amount: estimated?.amount ?? null,
      estimated_currency: estimated?.currency ?? null,
      stripe_product_id: sub.stripe_product_id,
      stripe_price_id: sub.stripe_price_id,
      default_payment_method_id: sub.default_payment_method_id,
      default_payment_method_brand: sub.default_payment_method_brand,
      default_payment_method_last4: sub.default_payment_method_last4,
      latest_invoice_id: sub.latest_invoice_id,
      latest_invoice_status: sub.latest_invoice_status,
      latest_invoice_number: sub.latest_invoice_number,
      latest_invoice_url: sub.latest_invoice_url,
      latest_invoice_pdf: sub.latest_invoice_pdf,
      latest_invoice_amount: sub.latest_invoice_amount,
      latest_invoice_currency: sub.latest_invoice_currency,
      latest_invoice_created: sub.latest_invoice_created ? sub.latest_invoice_created.toISOString() : null,
      days_until_due: sub.days_until_due,
      last_payment_error_code: sub.last_payment_error_code,
      last_payment_error_message: sub.last_payment_error_message,
      last_synced_at: sub.last_synced_at ? sub.last_synced_at.toISOString() : null,
      stripe_subscription_id: sub.stripe_subscription_id,
      stripe_customer_id: sub.stripe_customer_id,
      canceled_at_effective: sub.canceled_at_effective ? sub.canceled_at_effective.toISOString() : null,
      is_subscription_healthy: isHealthy,
      trial_days_remaining: trialDaysRemaining,
      payment_due_at: paymentDueAt,
      freeze_effective_at: freezeEffectiveAt,
    };
  }

  async getBillingProfile(opts: { tenantId: string }) {
    const tenant = await this.requireTenant(opts.tenantId);
    const customer = this.getCustomerContact(tenant);
    const invoice = this.getInvoiceContact(tenant);
    const invoices = await this.listRecentInvoices(tenant);
    return {
      customer: this.contactToResponse(customer),
      invoice: this.contactToResponse(invoice),
      invoice_missing_fields: missingInvoiceFields(invoice),
      invoices,
    };
  }

  async updateBillingProfile(opts: {
    tenantId: string;
    customer?: BillingContactInput | null;
    invoice?: BillingContactInput | null;
    manager?: EntityManager;
    userId?: string | null;
  }) {
    const manager = opts.manager ?? this.tenants.manager;
    const tenant = await this.requireTenant(opts.tenantId, manager);
    const before = this.tenantBillingSnapshot(tenant);
    const currentCustomer = this.getCustomerContact(tenant);
    const currentInvoice = this.getInvoiceContact(tenant);

    const customer = this.normaliseContactInput(opts.customer ?? {}, currentCustomer);
    const invoice = this.normaliseContactInput(opts.invoice ?? {}, currentInvoice);

    const billingColumns: Partial<Tenant> = {
      // Every invoicing field is written, a cleared one as null: from then on the
      // invoicing details no longer borrow from the customer contact.
      billing_invoice_info: this.contactToStorage(invoice),
      billing_email: invoice.email,
      billing_company_name: invoice.company ?? invoice.name ?? tenant.name,
      billing_phone: invoice.phone,
      billing_tax_id: invoice.vatNumber,
      billing_address: this.addressToRecord(invoice.address),
    };
    // The customer contact is kept as stored unless the request changes it.
    if (opts.customer) billingColumns.billing_customer_info = this.contactToStorage(customer);
    // Only the billing columns: saving the loaded tenant would write back its
    // other columns (metadata, branding) as they were when it was read.
    await manager.getRepository(Tenant).update({ id: tenant.id }, billingColumns);
    const savedTenant = Object.assign(tenant, billingColumns);

    await this.audit.log(
      {
        table: 'tenants',
        recordId: savedTenant.id,
        action: 'update',
        before,
        after: this.tenantBillingSnapshot(savedTenant),
        userId: opts.userId ?? null,
      },
      { manager },
    );

    await this.syncStripeCustomerProfile(savedTenant, invoice);

    const invoices = await this.listRecentInvoices(savedTenant);

    return {
      customer: this.contactToResponse(customer),
      invoice: this.contactToResponse(invoice),
      invoice_missing_fields: missingInvoiceFields(invoice),
      invoices,
    };
  }

  async createCheckoutSession(opts: {
    tenantId: string;
    manager?: EntityManager;
    planKey: PlanKey;
    interval: IntervalKey;
    successUrl?: string | null;
    cancelUrl?: string | null;
    metadata?: Record<string, string>;
    allowPromotionCodes?: boolean;
  }) {
    // Only a current plan can be bought, always at its configured price.
    const planKey = opts.planKey;
    const interval = opts.interval;
    if (!planKey || !Object.prototype.hasOwnProperty.call(PLANS, planKey)) {
      throw new BadRequestException('Unknown plan');
    }
    if (interval !== 'monthly' && interval !== 'annual') {
      throw new BadRequestException('Unknown billing interval');
    }
    const priceId = getPriceId(this.stripeConfig, interval, planKey);
    if (!priceId) {
      throw new BadRequestException('Stripe price not configured for requested plan');
    }

    const client = this.getStripeClientOrThrow();
    const tenant = await this.requireTenant(opts.tenantId);
    const invoiceProfile = this.requireCompleteInvoiceProfile(tenant);
    const manager = opts.manager ?? null;
    const customerId = await this.ensureStripeCustomerForTenant(tenant, { manager, invoiceProfile });

    const successUrl = opts.successUrl ?? this.stripeConfig.getCheckoutSuccessUrl();
    const cancelUrl = opts.cancelUrl ?? this.stripeConfig.getCheckoutCancelUrl();

    const quantity = CLOUD_SUBSCRIPTION_QUANTITY;

    // Card-only checkout is enforced for the checkout flow.
    const session = await client.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      success_url: successUrl || undefined,
      cancel_url: cancelUrl || undefined,
      payment_method_types: ['card'],
      allow_promotion_codes: opts.allowPromotionCodes ?? false,
      line_items: [
        {
          price: priceId,
          quantity,
        },
      ],
      subscription_data: {
        metadata: {
          tenant_id: tenant.id,
          tenant_slug: tenant.slug,
          ...(planKey ? { plan_key: planKey, billing_channel: 'saas' } : {}),
          ...(opts.metadata ?? {}),
        },
      },
      metadata: {
        tenant_id: tenant.id,
      },
    });

    if (!session?.url) {
      throw new BadRequestException('Stripe did not return a Checkout URL');
    }

    if (session.subscription && typeof session.subscription === 'string') {
      await this.updateSubscriptionCustomer(tenant.id, customerId, { manager, subscriptionId: session.subscription });
    } else {
      await this.updateSubscriptionCustomer(tenant.id, customerId, { manager });
    }

    return { url: session.url, id: session.id };
  }

  async createCustomerPortalSession(opts: { tenantId: string; manager?: EntityManager; returnUrl?: string | null }) {
    const client = this.getStripeClientOrThrow();
    const tenant = await this.requireTenant(opts.tenantId);
    const customerId = await this.ensureStripeCustomerForTenant(tenant, { manager: opts.manager ?? null });
    const returnUrl = opts.returnUrl ?? this.stripeConfig.getBillingPortalReturnUrl() ?? this.stripeConfig.getCheckoutSuccessUrl();

    const session = await client.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl || undefined,
    });

    if (!session?.url) {
      throw new BadRequestException('Stripe did not return a portal URL');
    }

    return { url: session.url, id: session.id };
  }

  async changePlan(tenantId: string, planKey: PlanKey, interval: IntervalKey, userId?: string | null, manager?: EntityManager) {
    const client = this.getStripeClientOrThrow();
    const mg = manager ?? this.subs.manager;
    const sub = await this.ensureSubscription(mg);
    const before = this.subscriptionAuditSnapshot(sub);

    if (!sub.stripe_subscription_id || !sub.status || !(HEALTHY_STATUSES as readonly string[]).includes(sub.status)) {
      throw new BadRequestException('NO_ACTIVE_SUBSCRIPTION');
    }

    const targetPriceId = getPriceId(this.stripeConfig, interval, planKey);
    if (!targetPriceId) {
      throw new BadRequestException('Stripe price not configured for requested plan');
    }

    // Retrieve the Stripe subscription to get the existing item ID
    const stripeSub = await client.subscriptions.retrieve(sub.stripe_subscription_id);
    const existingItemId = stripeSub.items?.data?.[0]?.id;
    if (!existingItemId) {
      throw new BadRequestException('Unable to resolve existing subscription item');
    }

    await client.subscriptions.update(sub.stripe_subscription_id, {
      items: [{ id: existingItemId, price: targetPriceId }],
      collection_method: 'charge_automatically',
      payment_settings: {
        payment_method_types: ['card'],
      },
      metadata: { plan_key: planKey },
      proration_behavior: 'create_prorations',
    });

    // Update local subscription record
    sub.plan_name = toPlanDisplayName(planKey);
    sub.seat_limit = PLANS[planKey].seatLimit;
    sub.stripe_price_id = targetPriceId;
    sub.subscription_type = interval === 'annual' ? SubscriptionType.ANNUAL : SubscriptionType.MONTHLY;
    sub.collection_method = CollectionMethod.CHARGE_AUTOMATICALLY;
    sub.payment_mode = PaymentMode.CARD;
    sub.days_until_due = null;
    sub.last_synced_at = new Date();
    const saved = await mg.getRepository(Subscription).save(sub);
    await this.audit.log(
      {
        table: 'subscriptions',
        recordId: saved.id,
        action: 'update',
        before,
        after: this.subscriptionAuditSnapshot(saved),
        userId: userId ?? null,
      },
      { manager: mg },
    );

    return this.getSubscriptionSummary({ manager: mg, forceStripeRefresh: true });
  }

  async requestInvoice(tenantId: string, planKey: PlanKey, interval: IntervalKey, userId?: string | null, manager?: EntityManager) {
    const client = this.getStripeClientOrThrow();

    if (!isBankTransferEligible(planKey, interval)) {
      throw new BadRequestException('PLAN_NOT_BANK_TRANSFER_ELIGIBLE');
    }

    const priceId = getPriceId(this.stripeConfig, interval, planKey);
    if (!priceId) {
      throw new BadRequestException('Stripe price not configured for requested plan');
    }

    const tenant = await this.requireTenant(tenantId);
    const invoiceContact = this.requireCompleteInvoiceProfile(tenant);
    const mg = manager ?? this.subs.manager;
    const sub = await this.ensureSubscription(mg);
    const before = this.subscriptionAuditSnapshot(sub);
    const customerId = await this.ensureStripeCustomerForTenant(tenant, { manager: mg, invoiceProfile: invoiceContact });
    const euBankTransferCountry = this.resolveEuBankTransferCountry(invoiceContact.address.country);
    let stripeSubResult: any | null = null;
    let previousLatestInvoiceId: string | null = null;

    if (sub.stripe_subscription_id && sub.status && (HEALTHY_STATUSES as readonly string[]).includes(sub.status)) {
      // Update existing subscription (like changePlan)
      const stripeSub = await client.subscriptions.retrieve(sub.stripe_subscription_id);
      const existingItemId = stripeSub.items?.data?.[0]?.id;
      if (!existingItemId) {
        throw new BadRequestException('Unable to resolve existing subscription item');
      }
      previousLatestInvoiceId = this.extractStripeInvoiceId(stripeSub?.latest_invoice);
      const invoicePaymentMethodTypes = await this.resolveInvoicePaymentMethodTypes(customerId, stripeSub?.default_payment_method);
      const invoicePaymentSettings = this.buildSendInvoicePaymentSettings(invoicePaymentMethodTypes, euBankTransferCountry);

      stripeSubResult = await client.subscriptions.update(sub.stripe_subscription_id, {
        items: [{ id: existingItemId, price: priceId }],
        collection_method: 'send_invoice',
        days_until_due: 30,
        payment_settings: invoicePaymentSettings,
        metadata: { plan_key: planKey, billing_channel: 'saas' },
        // Force immediate invoice creation for proration/upgrade deltas.
        proration_behavior: 'always_invoice',
        expand: ['latest_invoice'],
      });
    } else {
      // Create a new Stripe subscription with send_invoice
      const invoicePaymentMethodTypes = await this.resolveInvoicePaymentMethodTypes(customerId);
      const invoicePaymentSettings = this.buildSendInvoicePaymentSettings(invoicePaymentMethodTypes, euBankTransferCountry);
      stripeSubResult = await client.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId, quantity: CLOUD_SUBSCRIPTION_QUANTITY }],
        collection_method: 'send_invoice',
        days_until_due: 30,
        payment_settings: invoicePaymentSettings,
        metadata: { plan_key: planKey, billing_channel: 'saas', tenant_id: tenant.id, tenant_slug: tenant.slug },
        expand: ['latest_invoice'],
      });

      sub.stripe_subscription_id = stripeSubResult.id;
      sub.stripe_customer_id = customerId;
    }

    // Update local subscription record
    sub.plan_name = toPlanDisplayName(planKey);
    sub.seat_limit = PLANS[planKey].seatLimit;
    sub.stripe_price_id = priceId;
    sub.subscription_type = interval === 'annual' ? SubscriptionType.ANNUAL : SubscriptionType.MONTHLY;
    sub.collection_method = CollectionMethod.SEND_INVOICE;
    sub.payment_mode = PaymentMode.BANK_TRANSFER;
    sub.days_until_due = 30;
    sub.last_synced_at = new Date();
    const saved = await mg.getRepository(Subscription).save(sub);
    await this.audit.log(
      {
        table: 'subscriptions',
        recordId: saved.id,
        action: 'update',
        before,
        after: this.subscriptionAuditSnapshot(saved),
        userId: userId ?? null,
      },
      { manager: mg },
    );

    const preferredInvoiceId = this.extractStripeInvoiceId(stripeSubResult?.latest_invoice);
    const latestInvoice = sub.stripe_subscription_id
      ? await this.resolveSubscriptionInvoice({
          customerId,
          subscriptionId: sub.stripe_subscription_id,
          previousInvoiceId: previousLatestInvoiceId,
          preferredInvoiceId,
        })
      : null;

    const fallbackInvoice = !latestInvoice && !previousLatestInvoiceId && stripeSubResult
      ? await this.retrieveLatestInvoice(stripeSubResult)
      : null;

    const invoiceForAccess = await this.ensureInvoiceAccessible(latestInvoice ?? fallbackInvoice ?? null);
    const summary = await this.getSubscriptionSummary({ manager: mg, forceStripeRefresh: true });
    return {
      ...summary,
      hosted_invoice_url: invoiceForAccess?.hosted_invoice_url ?? null,
    };
  }

  /**
   * The invoice details a subscription needs (company, email, address, ISO country,
   * EU VAT number). Checked before any Stripe call: Stripe refuses a `send_invoice`
   * subscription without an email, and its invoices must carry the address and VAT.
   */
  private requireCompleteInvoiceProfile(tenant: Tenant): BillingContact {
    const contact = this.getInvoiceContact(tenant);
    const missing = missingInvoiceFields(contact);
    if (missing.length) {
      throw new BadRequestException({ message: 'BILLING_PROFILE_INCOMPLETE', missing });
    }
    return contact;
  }

  /**
   * The tenant's Stripe customer id, created when missing. With `invoiceProfile`
   * (subscribe time), the customer also gets the current invoice details and EU VAT
   * tax id; errors are not swallowed, and a VAT number Stripe refuses becomes
   * VAT_NUMBER_INVALID.
   */
  private async ensureStripeCustomerForTenant(
    tenant: Tenant,
    opts: { manager: EntityManager | null; invoiceProfile?: BillingContact },
  ): Promise<string> {
    const client = this.getStripeClientOrThrow();
    const profile = opts.invoiceProfile ?? null;
    if (tenant.stripe_customer_id) {
      // Verify the customer still exists in the current Stripe environment
      try {
        const customer = await client.customers.retrieve(tenant.stripe_customer_id);
        if ((customer as any)?.deleted === true) {
          this.logger.warn(`Deleted Stripe customer ${tenant.stripe_customer_id} for tenant ${tenant.id} — creating new customer`);
          tenant.stripe_customer_id = null as any;
        }
      } catch (error: any) {
        if (error?.statusCode === 404 || error?.code === 'resource_missing') {
          this.logger.warn(`Stale Stripe customer ${tenant.stripe_customer_id} for tenant ${tenant.id} — creating new customer`);
          tenant.stripe_customer_id = null as any;
        } else {
          throw error;
        }
      }
      if (tenant.stripe_customer_id) {
        const customerId = tenant.stripe_customer_id;
        if (profile) {
          await this.withVatNumberErrors(async () => {
            await client.customers.update(customerId, this.stripeCustomerDetails(tenant, profile));
            await this.syncStripeTaxIds(customerId, profile);
          });
        }
        await this.updateSubscriptionCustomer(tenant.id, customerId, { manager: opts.manager });
        return customerId;
      }
    }

    const invoiceContact = profile ?? this.getInvoiceContact(tenant);
    const euVat = profile ? euVatTaxIdValue(profile) : null;
    const customer = await this.withVatNumberErrors<{ id: string }>(() => client.customers.create({
      ...this.stripeCustomerDetails(tenant, invoiceContact),
      metadata: {
        tenant_id: tenant.id,
        tenant_slug: tenant.slug,
      },
      ...(euVat ? { tax_id_data: [{ type: 'eu_vat' as const, value: euVat }] } : {}),
    }));

    // The tenant was loaded by the caller before the Stripe calls: write the
    // customer id only, never the rest of that copy.
    tenant.stripe_customer_id = customer.id;
    await this.tenants.update({ id: tenant.id }, { stripe_customer_id: customer.id });
    await this.updateSubscriptionCustomer(tenant.id, customer.id, { manager: opts.manager });
    return customer.id;
  }

  /** The Stripe customer fields KANAP owns: email, name (company), phone, address. */
  private stripeCustomerDetails(tenant: Tenant, contact: BillingContact) {
    return {
      email: contact.email || undefined,
      name: contact.company || contact.name || tenant.name,
      phone: contact.phone || undefined,
      address: this.normaliseStripeAddress(this.addressToRecord(contact.address)),
    };
  }

  /**
   * Keeps the customer's `eu_vat` tax ids in line with the invoice details: one id
   * with the normalised EU VAT number, none for a non-EU country or no VAT number.
   * Other tax id types are left alone.
   */
  private async syncStripeTaxIds(customerId: string, contact: BillingContact): Promise<void> {
    const client = this.getStripeClientOrThrow();
    const target = euVatTaxIdValue(contact);
    const existing = await client.customers.listTaxIds(customerId, { limit: 100 });
    let kept = false;
    for (const taxId of existing?.data ?? []) {
      if (taxId?.type !== 'eu_vat') continue;
      if (target && !kept && normaliseVatNumber(taxId.value) === target) {
        kept = true;
        continue;
      }
      await client.customers.deleteTaxId(customerId, taxId.id);
    }
    if (target && !kept) {
      await client.customers.createTaxId(customerId, { type: 'eu_vat', value: target });
    }
  }

  private async withVatNumberErrors<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error: any) {
      if (error?.code === 'tax_id_invalid' || error?.raw?.code === 'tax_id_invalid') {
        this.logger.warn(
          `Stripe refused the VAT number: code=${error?.code ?? error?.raw?.code ?? 'unknown'} `
          + `param=${error?.param ?? error?.raw?.param ?? 'unknown'} `
          + `request=${error?.requestId ?? error?.raw?.requestId ?? 'unknown'} `
          + `message=${error?.message ?? error?.raw?.message ?? ''}`,
        );
        throw new BadRequestException({ message: 'VAT_NUMBER_INVALID' });
      }
      throw error;
    }
  }

  private normaliseStripeAddress(address: Record<string, any> | null | undefined) {
    if (!address) return undefined;
    const entries: Record<string, any> = { ...address };
    const mapped: Record<string, any> = {};
    if (entries.line1) mapped.line1 = entries.line1;
    if (entries.line2) mapped.line2 = entries.line2;
    if (entries.city) mapped.city = entries.city;
    if (entries.state) mapped.state = entries.state;
    if (entries.postal_code) mapped.postal_code = entries.postal_code;
    if (entries.country) mapped.country = entries.country;
    return Object.keys(mapped).length ? mapped : undefined;
  }

  private async updateSubscriptionCustomer(
    tenantId: string,
    customerId: string,
    opts: { manager?: EntityManager | null; subscriptionId?: string },
  ): Promise<void> {
    const runner = opts.manager;
    if (runner) {
      await this.applyCustomerUpdate(runner, customerId, opts.subscriptionId ?? null);
      return;
    }
    await withTenant(this.dataSource, tenantId, async (manager) => {
      await this.applyCustomerUpdate(manager, customerId, opts.subscriptionId ?? null);
    });
  }

  private getCustomerContact(tenant: Tenant): BillingContact {
    const fallback = this.defaultContactFallback(tenant);
    return this.fromStoredContact(tenant.billing_customer_info, fallback);
  }

  /**
   * The invoicing details, field by field: the saved invoicing value (a field the user
   * cleared stays empty), else the stored customer contact (the former customer card),
   * else the tenant billing columns. A tenant who only filled the customer card finds
   * its values here; the next save writes them as invoicing values.
   */
  private getInvoiceContact(tenant: Tenant): BillingContact {
    const columns = this.defaultInvoiceFallback(tenant);
    const customer = this.fromStoredContact(tenant.billing_customer_info, EMPTY_CONTACT);
    const fallback: BillingContact = {
      name: customer.name ?? columns.name,
      company: customer.company ?? columns.company,
      email: customer.email ?? columns.email,
      phone: customer.phone ?? columns.phone,
      vatNumber: customer.vatNumber ?? columns.vatNumber,
      address: {
        line1: customer.address.line1 ?? columns.address.line1,
        line2: customer.address.line2 ?? columns.address.line2,
        city: customer.address.city ?? columns.address.city,
        state: customer.address.state ?? columns.address.state,
        postalCode: customer.address.postalCode ?? columns.address.postalCode,
        country: customer.address.country ?? columns.address.country,
      },
    };
    return this.fromStoredContact(tenant.billing_invoice_info, fallback);
  }

  private defaultContactFallback(tenant: Tenant): BillingContact {
    return {
      name: null,
      company: tenant.name ?? null,
      email: this.toNullableString(tenant.billing_email),
      phone: this.toNullableString(tenant.billing_phone),
      vatNumber: this.toNullableString(tenant.billing_tax_id),
      address: this.fromStoredAddress(tenant.billing_address, EMPTY_CONTACT.address),
    };
  }

  private defaultInvoiceFallback(tenant: Tenant): BillingContact {
    return {
      name: null,
      company: this.toNullableString(tenant.billing_company_name) ?? tenant.name ?? null,
      email: this.toNullableString(tenant.billing_email),
      phone: this.toNullableString(tenant.billing_phone),
      vatNumber: this.toNullableString(tenant.billing_tax_id),
      address: this.fromStoredAddress(tenant.billing_address, EMPTY_CONTACT.address),
    };
  }

  /**
   * A stored contact over its fallback, field by field. A key the record holds wins,
   * null or empty included (the user cleared it); a key it lacks (never saved) takes
   * the fallback.
   */
  private fromStoredContact(value: any, fallback: BillingContact): BillingContact {
    const data: Record<string, unknown> = value && typeof value === 'object' ? value : {};
    return {
      name: this.storedOr(data, ['name'], fallback.name),
      company: this.storedOr(data, ['company'], fallback.company),
      email: this.storedOr(data, ['email'], fallback.email),
      phone: this.storedOr(data, ['phone'], fallback.phone),
      vatNumber: this.storedOr(data, ['vat_number', 'vatNumber'], fallback.vatNumber),
      address: this.fromStoredAddress(data.address, fallback.address),
    };
  }

  private fromStoredAddress(value: any, fallback: BillingAddress): BillingAddress {
    const data: Record<string, unknown> = value && typeof value === 'object' ? value : {};
    const country = data.country !== undefined ? this.toNullableCountry(data.country) : fallback.country;
    return {
      line1: this.storedOr(data, ['line1'], fallback.line1),
      line2: this.storedOr(data, ['line2'], fallback.line2),
      city: this.storedOr(data, ['city'], fallback.city),
      state: this.storedOr(data, ['state'], fallback.state),
      postalCode: this.storedOr(data, ['postal_code', 'postalCode'], fallback.postalCode),
      country,
    };
  }

  /** The first of `keys` the record holds (null when it holds an empty value), else the fallback. */
  private storedOr(data: Record<string, unknown>, keys: string[], fallback: string | null): string | null {
    for (const key of keys) {
      if (data[key] !== undefined) return this.toNullableString(data[key]);
    }
    return fallback;
  }

  /**
   * A PATCH payload over the current contact: a field the payload holds replaces the
   * current value, and an empty string or null clears it; a field it lacks stays as
   * it is. `address: null` leaves the address as it is.
   */
  private normaliseContactInput(input: BillingContactInput, current: BillingContact): BillingContact {
    const data = input as Record<string, unknown>;
    return {
      name: this.storedOr(data, ['name'], current.name),
      company: this.storedOr(data, ['company'], current.company),
      email: this.storedOr(data, ['email'], current.email),
      phone: this.storedOr(data, ['phone'], current.phone),
      vatNumber: this.storedOr(data, ['vatNumber'], current.vatNumber),
      address: input.address ? this.fromStoredAddress(input.address, current.address) : { ...current.address },
    };
  }

  /** Every field is written, an empty one as null, so a cleared field stays cleared. */
  private contactToStorage(contact: BillingContact): Record<string, any> {
    return {
      name: contact.name,
      company: contact.company,
      email: contact.email,
      phone: contact.phone,
      vat_number: contact.vatNumber,
      address: {
        line1: contact.address.line1,
        line2: contact.address.line2,
        city: contact.address.city,
        state: contact.address.state,
        postal_code: contact.address.postalCode,
        country: contact.address.country,
      },
    };
  }

  private contactToResponse(contact: BillingContact) {
    return {
      name: contact.name,
      company: contact.company,
      email: contact.email,
      phone: contact.phone,
      vatNumber: contact.vatNumber,
      address: {
        line1: contact.address.line1,
        line2: contact.address.line2,
        city: contact.address.city,
        state: contact.address.state,
        postalCode: contact.address.postalCode,
        country: contact.address.country,
      },
    };
  }

  private addressToRecord(address: BillingAddress | null | undefined): Record<string, any> | null {
    if (!address) return null;
    const record: Record<string, any> = {};
    if (address.line1) record.line1 = address.line1;
    if (address.line2) record.line2 = address.line2;
    if (address.city) record.city = address.city;
    if (address.state) record.state = address.state;
    if (address.postalCode) record.postal_code = address.postalCode;
    if (address.country) record.country = address.country;
    return Object.keys(record).length ? record : null;
  }

  private toNullableString(value: any): string | null {
    if (value === null || value === undefined) return null;
    const str = String(value).trim();
    return str.length ? str : null;
  }

  /** An ISO alpha-2 code is stored uppercase; a legacy free-text value is kept as typed. */
  private toNullableCountry(value: any): string | null {
    const str = this.toNullableString(value);
    if (!str) return null;
    return toIsoCountry(str) ?? str;
  }

  private async syncStripeCustomerProfile(tenant: Tenant, invoice: BillingContact): Promise<void> {
    const client = this.stripeClient.getClient();
    if (!client || !tenant.stripe_customer_id) return;
    try {
      await client.customers.update(tenant.stripe_customer_id, this.stripeCustomerDetails(tenant, invoice));
      await this.syncStripeTaxIds(tenant.stripe_customer_id, invoice);
    } catch (error) {
      this.logger.warn(`Failed to sync Stripe customer ${tenant.stripe_customer_id}: ${(error as Error).message}`);
    }
  }

  private async shouldRefreshFromStripe(sub: Subscription): Promise<boolean> {
    if (!sub.stripe_subscription_id) return false;
    const missingCore = !sub.current_period_end || !sub.amount || !sub.currency;
    // `stripe_subscription_id` is already known to be set (guarded above).
    const missingPaymentMethod = !sub.default_payment_method_id;
    const stale = !sub.last_synced_at || Date.now() - sub.last_synced_at.getTime() > 5 * 60 * 1000;
    return (missingCore || missingPaymentMethod) && stale;
  }

  private async refreshSubscriptionFromStripe(sub: Subscription, manager: EntityManager): Promise<Subscription> {
    const client = this.stripeClient.getClient();
    if (!client || !sub.stripe_subscription_id) return sub;
    const stripeSub = await client.subscriptions.retrieve(sub.stripe_subscription_id, {
      expand: ['default_payment_method', 'items.data.price.tiers'],
    });

    if (!stripeSub) return sub;

    const quantity = this.resolveStripeQuantity(stripeSub);

    // Plan resolution: metadata → price ID → legacy name fallback
    const stripePriceId = stripeSub?.items?.data?.[0]?.price?.id;
    const resolvedPlanKey =
      (stripeSub?.metadata?.plan_key as PlanKey | undefined) ??
      (stripePriceId ? resolvePlanKeyFromPriceId(stripePriceId) : null) ??
      resolvePlanKeyFromLegacyName(sub.plan_name);

    if (resolvedPlanKey) {
      sub.plan_name = toPlanDisplayName(resolvedPlanKey);
      sub.seat_limit = PLANS[resolvedPlanKey].seatLimit;
    } else {
      // The Stripe quantity is not a number of users: keep the stored user limit.
      sub.plan_name = stripeSub?.plan?.nickname ?? sub.plan_name;
    }
    sub.active_seats = quantity;
    sub.subscription_type = this.resolveSubscriptionType(stripeSub?.items?.data?.[0]?.price);
    sub.payment_mode = this.resolvePaymentMode(stripeSub);
    sub.status = this.resolveStatus(stripeSub?.status) ?? sub.status;
    sub.collection_method = this.resolveCollectionMethod(stripeSub?.collection_method) ?? sub.collection_method;
    sub.current_period_start = this.toDate(stripeSub?.current_period_start);
    sub.current_period_end = this.toDate(stripeSub?.current_period_end);
    sub.trial_end = this.toDate(stripeSub?.trial_end);
    sub.cancel_at = this.toDate(stripeSub?.cancel_at);
    sub.canceled_at = this.toDate(stripeSub?.canceled_at);
    sub.canceled_at_effective = stripeSub?.cancel_at_period_end ? this.toDate(stripeSub?.current_period_end) : null;
    sub.next_payment_at = this.toDate(stripeSub?.current_period_end);
    sub.currency = typeof stripeSub?.currency === 'string' ? stripeSub.currency.toUpperCase() : sub.currency;
    if (!sub.currency) {
      const priceCurrency = stripeSub?.items?.data?.[0]?.price?.currency;
      if (priceCurrency) {
        sub.currency = String(priceCurrency).toUpperCase();
      }
    }
    sub.amount = this.computeStripeAmount(stripeSub);
    sub.stripe_product_id = stripeSub?.items?.data?.[0]?.price?.product ?? sub.stripe_product_id;
    sub.stripe_price_id = stripeSub?.items?.data?.[0]?.price?.id ?? sub.stripe_price_id;
    sub.days_until_due = typeof stripeSub?.days_until_due === 'number' ? stripeSub.days_until_due : sub.days_until_due;
    sub.stripe_customer_id = typeof stripeSub?.customer === 'string' ? stripeSub.customer : sub.stripe_customer_id;

    const paymentMethodInfo = await this.describeStripePaymentMethod(stripeSub?.default_payment_method);
    if (paymentMethodInfo) {
      sub.default_payment_method_id = paymentMethodInfo.id;
      sub.default_payment_method_brand = paymentMethodInfo.brand;
      sub.default_payment_method_last4 = paymentMethodInfo.last4;
    }

    const latestInvoice = await this.retrieveLatestInvoice(stripeSub);
    if (latestInvoice) {
      sub.latest_invoice_id = latestInvoice.id ?? sub.latest_invoice_id ?? null;
      sub.latest_invoice_status = latestInvoice.status ?? sub.latest_invoice_status ?? null;
      sub.latest_invoice_number = latestInvoice.number ?? sub.latest_invoice_number ?? null;
      sub.latest_invoice_url = latestInvoice.hosted_invoice_url ?? sub.latest_invoice_url ?? null;
      sub.latest_invoice_pdf = latestInvoice.invoice_pdf ?? sub.latest_invoice_pdf ?? null;
      if (typeof latestInvoice.total === 'number') sub.latest_invoice_amount = latestInvoice.total;
      if (latestInvoice.currency) sub.latest_invoice_currency = String(latestInvoice.currency).toUpperCase();
      if (latestInvoice.created) sub.latest_invoice_created = this.toDate(latestInvoice.created);
      sub.last_payment_error_code = latestInvoice.last_payment_error?.code ?? null;
      sub.last_payment_error_message = latestInvoice.last_payment_error?.message ?? null;
    }

    sub.last_synced_at = new Date();
    await manager.getRepository(Subscription).save(sub);
    return sub;
  }

  private async describeStripePaymentMethod(source: any): Promise<{ id: string; brand: string | null; last4: string | null } | null> {
    if (!source) return null;
    const client = this.stripeClient.getClient();
    if (!client) return null;

    let paymentMethod: any = source;
    if (typeof source === 'string') {
      try {
        paymentMethod = await client.paymentMethods.retrieve(source);
      } catch (error) {
        this.logger.warn(`Unable to retrieve payment method ${source}: ${(error as Error).message}`);
        return { id: source, brand: null, last4: null };
      }
    }

    if (!paymentMethod || typeof paymentMethod !== 'object') return null;
    const id = paymentMethod.id ?? (typeof source === 'string' ? source : null);
    if (!id) return null;

    if (paymentMethod.card) {
      return {
        id,
        brand: paymentMethod.card.brand ? String(paymentMethod.card.brand).toUpperCase() : null,
        last4: paymentMethod.card.last4 ?? null,
      };
    }
    if (paymentMethod.sepa_debit) {
      return {
        id,
        brand: 'SEPA',
        last4: paymentMethod.sepa_debit.last4 ?? null,
      };
    }
    if (paymentMethod.type) {
      const details = paymentMethod[paymentMethod.type];
      return {
        id,
        brand: String(paymentMethod.type).toUpperCase(),
        last4: details?.last4 ?? null,
      };
    }
    return { id, brand: null, last4: null };
  }

  private async resolveStripePaymentMethodType(source: any): Promise<string | null> {
    if (!source) return null;
    if (typeof source === 'object' && typeof source.type === 'string' && source.type.trim()) {
      return source.type.trim();
    }
    if (typeof source === 'string') {
      const client = this.stripeClient.getClient();
      if (!client) return null;
      try {
        const paymentMethod = await client.paymentMethods.retrieve(source);
        const type = paymentMethod?.type;
        if (typeof type === 'string' && type.trim()) return type.trim();
      } catch (error) {
        this.logger.warn(`Unable to resolve payment method type for ${source}: ${(error as Error).message}`);
      }
    }
    return null;
  }

  private extractStripeInvoiceId(source: any): string | null {
    if (!source) return null;
    if (typeof source === 'string') return source;
    if (typeof source === 'object' && typeof source.id === 'string') return source.id;
    return null;
  }

  private async resolveInvoicePaymentMethodTypes(customerId: string, subscriptionDefaultPaymentMethod?: any): Promise<string[]> {
    const types = new Set<string>(['customer_balance', 'card']);

    const subscriptionDefaultType = await this.resolveStripePaymentMethodType(subscriptionDefaultPaymentMethod);
    if (subscriptionDefaultType) types.add(subscriptionDefaultType);

    const client = this.stripeClient.getClient();
    if (client) {
      try {
        const customer = await client.customers.retrieve(customerId, {
          expand: ['invoice_settings.default_payment_method'],
        });
        const customerDefault = (customer as any)?.invoice_settings?.default_payment_method;
        const customerDefaultType = await this.resolveStripePaymentMethodType(customerDefault);
        if (customerDefaultType) types.add(customerDefaultType);
      } catch (error) {
        this.logger.warn(`Unable to retrieve customer ${customerId} to resolve invoice payment methods: ${(error as Error).message}`);
      }
    }

    return Array.from(types);
  }

  private buildSendInvoicePaymentSettings(paymentMethodTypes: string[], bankTransferCountry: string): any {
    const types = Array.from(
      new Set(
        (paymentMethodTypes ?? [])
          .map((type) => String(type || '').trim())
          .filter((type) => type.length > 0),
      ),
    );
    if (!types.includes('customer_balance')) types.unshift('customer_balance');
    if (!types.includes('card')) types.push('card');

    return {
      payment_method_types: types,
      payment_method_options: {
        customer_balance: {
          funding_type: 'bank_transfer',
          bank_transfer: {
            type: 'eu_bank_transfer',
            eu_bank_transfer: {
              country: bankTransferCountry,
            },
          },
        },
      },
    };
  }

  private resolveEuBankTransferCountry(sourceCountry?: string | null): string {
    const configured = String(process.env.STRIPE_EU_BANK_TRANSFER_COUNTRY || '').trim().toUpperCase();
    if (STRIPE_EU_BANK_TRANSFER_COUNTRIES.has(configured)) {
      return configured;
    }
    const source = String(sourceCountry || '').trim().toUpperCase();
    if (STRIPE_EU_BANK_TRANSFER_COUNTRIES.has(source)) {
      return source;
    }
    return STRIPE_DEFAULT_EU_BANK_TRANSFER_COUNTRY;
  }

  private async resolveSubscriptionInvoice(opts: {
    customerId: string;
    subscriptionId: string;
    previousInvoiceId?: string | null;
    preferredInvoiceId?: string | null;
  }): Promise<any | null> {
    const client = this.stripeClient.getClient();
    if (!client) return null;

    try {
      const invoices = await client.invoices.list({
        customer: opts.customerId,
        subscription: opts.subscriptionId,
        collection_method: 'send_invoice',
        limit: 10,
      });
      const items = invoices?.data ?? [];

      if (opts.previousInvoiceId) {
        const newerInvoice = items.find((invoice: any) => invoice?.id && invoice.id !== opts.previousInvoiceId);
        if (newerInvoice) return newerInvoice;
      }

      if (opts.preferredInvoiceId) {
        const fromList = items.find((invoice: any) => invoice?.id === opts.preferredInvoiceId);
        if (fromList) return fromList;
        if (!opts.previousInvoiceId || opts.preferredInvoiceId !== opts.previousInvoiceId) {
          try {
            return await client.invoices.retrieve(opts.preferredInvoiceId);
          } catch (error) {
            this.logger.warn(`Unable to retrieve preferred invoice ${opts.preferredInvoiceId}: ${(error as Error).message}`);
          }
        }
      }

      if (!opts.previousInvoiceId && items.length > 0) {
        return items[0];
      }
    } catch (error) {
      this.logger.warn(`Unable to resolve latest invoice for subscription ${opts.subscriptionId}: ${(error as Error).message}`);
    }

    return null;
  }

  private async ensureInvoiceAccessible(invoice: any | null): Promise<any | null> {
    if (!invoice) return null;
    const client = this.stripeClient.getClient();
    if (!client) return invoice;

    const invoiceId = this.extractStripeInvoiceId(invoice);
    if (!invoiceId) return invoice;

    if (invoice?.status && invoice.status !== 'draft') {
      if (invoice.hosted_invoice_url) return invoice;
      try {
        return await client.invoices.retrieve(invoiceId);
      } catch (error) {
        this.logger.warn(`Unable to refresh invoice ${invoiceId}: ${(error as Error).message}`);
        return invoice;
      }
    }

    try {
      const finalized = await client.invoices.finalizeInvoice(invoiceId, {
        auto_advance: true,
      });
      if (finalized?.hosted_invoice_url) {
        return finalized;
      }
      return await client.invoices.retrieve(invoiceId);
    } catch (error) {
      this.logger.warn(`Unable to finalize invoice ${invoiceId}: ${(error as Error).message}`);
      try {
        return await client.invoices.retrieve(invoiceId);
      } catch (retrieveError) {
        this.logger.warn(`Unable to retrieve invoice ${invoiceId}: ${(retrieveError as Error).message}`);
      }
      return invoice;
    }
  }

  private async retrieveLatestInvoice(stripeSub: any): Promise<any | null> {
    const client = this.stripeClient.getClient();
    if (!client) return null;
    const latest = stripeSub?.latest_invoice;
    try {
      if (typeof latest === 'string') {
        return await client.invoices.retrieve(latest);
      }
      if (latest) return latest;
    } catch (error) {
      this.logger.warn(`Unable to retrieve latest invoice for subscription ${stripeSub?.id}: ${(error as Error).message}`);
    }
    return null;
  }

  /**
   * Amount of one period at the quantity checkout uses: the price does not depend on the
   * number of users. On-premise has no hosted subscription, so no amount.
   */
  private async estimateRecurringAmount(sub: Subscription): Promise<{ amount: number; currency: string } | null> {
    if (Features.SINGLE_TENANT) return null;
    const priceInfo = await this.resolvePriceInfo(sub);
    if (!priceInfo || !priceInfo.currency) return null;
    const amount = computePriceAmount(priceInfo, CLOUD_SUBSCRIPTION_QUANTITY);
    if (amount == null) return null;
    return { amount, currency: priceInfo.currency };
  }

  private async resolvePriceInfo(sub: Subscription): Promise<NormalisedPrice | null> {
    const client = this.stripeClient.getClient();
    const priceId = this.resolveConfiguredPriceId(sub);
    if (!priceId) return null;

    if (this.priceCache.has(priceId)) {
      return this.priceCache.get(priceId)!;
    }

    if (!client) return null;
    try {
      const price = await client.prices.retrieve(priceId, { expand: ['tiers'] });
      const normalised = normaliseStripePrice(price);
      if (!normalised || !normalised.currency) return null;
      this.priceCache.set(priceId, normalised);
      return normalised;
    } catch (error) {
      this.logger.warn(`Unable to retrieve Stripe price ${priceId}: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Configured price of the subscription's current plan for its interval. A plan that is no
   * longer sold (an old Stripe price, "Starter", "Trial") has no price, so no estimate.
   */
  private resolveConfiguredPriceId(sub: Subscription): string | null {
    const planKey =
      (sub.stripe_price_id ? resolvePlanKeyFromPriceId(sub.stripe_price_id) : null)
      ?? resolvePlanKeyFromLegacyName(sub.plan_name);
    if (!planKey) return null;
    const interval: IntervalKey = sub.subscription_type === SubscriptionType.ANNUAL ? 'annual' : 'monthly';
    return getPriceId(this.stripeConfig, interval, planKey);
  }

  private resolveStripeQuantity(subObject: any): number {
    if (typeof subObject?.quantity === 'number' && subObject.quantity > 0) return subObject.quantity;
    const itemQty = subObject?.items?.data?.[0]?.quantity;
    if (typeof itemQty === 'number' && itemQty > 0) return itemQty;
    return 1;
  }

  private computeStripeAmount(subObject: any): number | null {
    const quantity = this.resolveStripeQuantity(subObject);
    const { amount } = computeStripePriceAmount(subObject?.items?.data?.[0]?.price, quantity);
    if (amount != null) return amount;
    if (typeof subObject?.amount_due === 'number') return subObject.amount_due;
    if (typeof subObject?.plan?.amount === 'number') return subObject.plan.amount * quantity;
    const unitAmount = subObject?.items?.data?.[0]?.price?.unit_amount;
    if (typeof unitAmount === 'number') return unitAmount * quantity;
    return null;
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

  private resolveCollectionMethod(collectionMethod: any): CollectionMethod | null {
    if (collectionMethod === 'charge_automatically') return CollectionMethod.CHARGE_AUTOMATICALLY;
    if (collectionMethod === 'send_invoice') return CollectionMethod.SEND_INVOICE;
    return null;
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

  private toDate(value: any): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'number') {
      // Stripe timestamps are seconds
      if (value > 999999999999) return new Date(value);
      return new Date(value * 1000);
    }
    if (typeof value === 'string') {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }


  private async listRecentInvoices(tenant: Tenant): Promise<Array<{
    id: string;
    number: string | null;
    status: string | null;
    total: number | null;
    currency: string | null;
    hostedInvoiceUrl: string | null;
    invoicePdf: string | null;
    createdAt: string | null;
  }>> {
    const client = this.stripeClient.getClient();
    if (!client || !tenant.stripe_customer_id) return [];
    try {
      const invoices = await client.invoices.list({
        customer: tenant.stripe_customer_id,
        limit: 10,
        expand: ['data.payment_intent'],
      });
      return (invoices?.data ?? []).map((invoice: any) => ({
        id: invoice.id,
        number: invoice.number ?? null,
        status: invoice.status ?? null,
        total: typeof invoice.total === 'number' ? invoice.total : null,
        currency: invoice.currency ? String(invoice.currency).toUpperCase() : null,
        hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
        invoicePdf: invoice.invoice_pdf ?? null,
        createdAt: invoice.created ? new Date(invoice.created * 1000).toISOString() : null,
      }));
    } catch (error) {
      this.logger.warn(`Failed to list invoices for tenant ${tenant.id}: ${(error as Error).message}`);
      return [];
    }
  }

  private async applyCustomerUpdate(manager: EntityManager, customerId: string, subscriptionId: string | null) {
    const repo = manager.getRepository(Subscription);
    let sub = await repo.findOne({ where: {} });
    if (!sub) {
      sub = repo.create({
        plan_name: 'Trial',
        seat_limit: null,
        subscription_type: SubscriptionType.MONTHLY,
        payment_mode: PaymentMode.CARD,
      });
    }
    const customerChanged = sub.stripe_customer_id && sub.stripe_customer_id !== customerId;
    sub.stripe_customer_id = customerId;
    if (subscriptionId) {
      sub.stripe_subscription_id = subscriptionId;
    } else if (customerChanged) {
      // Customer changed (e.g. stale ID replaced) — clear old subscription reference
      sub.stripe_subscription_id = null as any;
      sub.status = null as any;
    }
    await repo.save(sub);
  }

  private getStripeClientOrThrow() {
    const client = this.stripeClient.getClient();
    if (!client) {
      throw new BadRequestException('Stripe is not configured');
    }
    return client;
  }

  private async ensureSubscription(manager: EntityManager): Promise<Subscription> {
    const repo = manager.getRepository(Subscription);
    let subscription = await repo.findOne({ where: {} });
    if (!subscription) {
      const defaults = Features.SINGLE_TENANT
        ? { plan_name: 'On-Prem', seat_limit: null, active_seats: 0, subscription_type: SubscriptionType.ANNUAL, payment_mode: PaymentMode.CARD, status: SubscriptionStatus.ACTIVE }
        : { plan_name: 'Trial', seat_limit: null, active_seats: 0, subscription_type: SubscriptionType.MONTHLY, payment_mode: PaymentMode.CARD };
      subscription = repo.create(defaults);
      subscription = await repo.save(subscription);
    } else if (Features.SINGLE_TENANT) {
      let changed = false;
      if (subscription.plan_name !== 'On-Prem') {
        subscription.plan_name = 'On-Prem';
        changed = true;
      }
      if (subscription.seat_limit !== null) {
        subscription.seat_limit = null;
        changed = true;
      }
      if (subscription.subscription_type !== SubscriptionType.ANNUAL) {
        subscription.subscription_type = SubscriptionType.ANNUAL;
        changed = true;
      }
      if (subscription.payment_mode !== PaymentMode.CARD) {
        subscription.payment_mode = PaymentMode.CARD;
        changed = true;
      }
      if (subscription.status !== SubscriptionStatus.ACTIVE) {
        subscription.status = SubscriptionStatus.ACTIVE;
        changed = true;
      }
      if (changed) {
        subscription = await repo.save(subscription);
      }
    }
    return subscription;
  }

  private async computeSeatsUsed(manager: EntityManager): Promise<number> {
    const usersRepo = manager.getRepository(User);
    return usersRepo
      .createQueryBuilder('user')
      .leftJoin('user.role', 'role')
      .where('user.status = :status', { status: 'enabled' })
      .andWhere('(role.role_name IS NULL OR LOWER(role.role_name) <> :contact)', { contact: 'contact' })
      .getCount();
  }

  private async requireTenant(id: string, manager?: EntityManager): Promise<Tenant> {
    const tenantRepo = manager ? manager.getRepository(Tenant) : this.tenants;
    const tenant = await tenantRepo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }
}
