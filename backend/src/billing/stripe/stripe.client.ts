import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { StripeConfigService, describeStripeMode } from './stripe.config';

type StripeInstance = any;

declare const require: any;

@Injectable()
export class StripeClientService implements OnModuleInit {
  private readonly logger = new Logger(StripeClientService.name);
  private stripe: StripeInstance | null = null;

  constructor(private readonly config: StripeConfigService) {}

  /** Says once at start-up which Stripe mode the API runs in, and warns on a mismatch. */
  onModuleInit(): void {
    if (!this.config.isConfigured()) return;
    const report = describeStripeMode(this.config.getSecretKey(), this.config.getApiVersion());
    this.logger.log(report.line);
    if (report.warning) this.logger.warn(report.warning);
  }

  getClient(): StripeInstance | null {
    if (!this.config.isConfigured()) {
      return null;
    }
    if (!this.stripe) {
      try {
        const Stripe = require('stripe');
        this.stripe = new Stripe(this.config.getSecretKey(), {
          apiVersion: this.config.getApiVersion(),
        });
      } catch (error) {
        this.logger.error('Failed to initialise Stripe client', error instanceof Error ? error.stack : String(error));
        throw error;
      }
    }
    return this.stripe;
  }
}
