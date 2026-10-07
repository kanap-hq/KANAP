import { Injectable } from '@nestjs/common';

const DEFAULT_API_VERSION = '2023-10-16';

@Injectable()
export class StripeConfigService {
  private readonly secretKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET || '';
  private readonly publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || '';
  private readonly webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
  private readonly checkoutSuccessUrl = process.env.STRIPE_CHECKOUT_SUCCESS_URL || process.env.APP_URL || '';
  private readonly checkoutCancelUrl = process.env.STRIPE_CHECKOUT_CANCEL_URL || process.env.APP_URL || '';
  private readonly billingPortalReturnUrl = process.env.STRIPE_PORTAL_RETURN_URL || process.env.APP_URL || '';
  private readonly apiVersion = process.env.STRIPE_API_VERSION || DEFAULT_API_VERSION;

  isConfigured(): boolean {
    return !!this.secretKey;
  }

  getSecretKey(): string {
    return this.secretKey;
  }

  getPublishableKey(): string | null {
    return this.publishableKey || null;
  }

  getWebhookSecret(): string | null {
    return this.webhookSecret || null;
  }

  getCheckoutSuccessUrl(): string | null {
    return this.checkoutSuccessUrl || null;
  }

  getCheckoutCancelUrl(): string | null {
    return this.checkoutCancelUrl || null;
  }

  getBillingPortalReturnUrl(): string | null {
    return this.billingPortalReturnUrl || null;
  }

  getApiVersion(): string {
    return this.apiVersion;
  }

  /** Price of a plan for an interval, from `STRIPE_PRICE_<PLAN>_<INTERVAL>`. */
  getPriceId(interval: 'monthly' | 'annual', planKey: string): string | null {
    if (!planKey) return null;
    const plan = planKey.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    const envKey = `STRIPE_PRICE_${plan}_${interval.toUpperCase()}`;
    const map = process.env as Record<string, string | undefined>;
    const value = map[envKey];
    return value && value.trim() ? value.trim() : null;
  }
}
