import { Injectable } from '@nestjs/common';
import { getEnvMode, isProductionEnv } from '../../common/env';

const DEFAULT_API_VERSION = '2023-10-16';

export type StripeKeyMode = 'test' | 'live' | 'unknown';

/** Test or live, from the key prefix (secret `sk_` or restricted `rk_`). */
export function stripeKeyMode(secretKey: string | null | undefined): StripeKeyMode {
  const key = String(secretKey ?? '').trim();
  if (/^(sk|rk)_test_/.test(key)) return 'test';
  if (/^(sk|rk)_live_/.test(key)) return 'live';
  return 'unknown';
}

/**
 * The start-up line naming the Stripe mode and API version (never the key), and a
 * warning when the mode does not match the environment: a live key outside production,
 * or a test key in production.
 */
export function describeStripeMode(
  secretKey: string | null | undefined,
  apiVersion: string,
  env: NodeJS.ProcessEnv = process.env,
): { mode: StripeKeyMode; line: string; warning: string | null } {
  const mode = stripeKeyMode(secretKey);
  const production = isProductionEnv(env);
  const envLabel = getEnvMode(env) || 'unset';
  let warning: string | null = null;
  if (mode === 'live' && !production) {
    warning = `[stripe] live key in a non-production environment (APP_ENV/NODE_ENV=${envLabel})`;
  } else if (mode === 'test' && production) {
    warning = `[stripe] test key in production (APP_ENV/NODE_ENV=${envLabel})`;
  }
  return { mode, line: `[stripe] mode=${mode} api=${apiVersion}`, warning };
}

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
