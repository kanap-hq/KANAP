import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { isProductionEnv } from '../common/env';
import { Features } from '../config/features';

type CaptchaMode = 'off' | 'monitor' | 'enforce';
type CaptchaAction = 'start-trial' | 'contact' | 'support-invoice';

type VerifyCaptchaInput = {
  token?: string | null;
  remoteIp?: string | null;
  action: CaptchaAction;
};

type TurnstileVerifyResponse = {
  success: boolean;
  action?: string;
  hostname?: string;
  challenge_ts?: string;
  ['error-codes']?: string[];
};

@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);
  private readonly mode: CaptchaMode;
  private readonly siteKey: string;
  private readonly secretKey: string;

  constructor() {
    this.mode = this.resolveMode();
    this.siteKey = String(process.env.TURNSTILE_SITE_KEY || '').trim();
    this.secretKey = String(process.env.TURNSTILE_SECRET_KEY || '').trim();

    if (this.mode === 'enforce') {
      if (!this.siteKey) throw new Error('FATAL: TURNSTILE_SITE_KEY is required when CAPTCHA_MODE=enforce');
      if (!this.secretKey) throw new Error('FATAL: TURNSTILE_SECRET_KEY is required when CAPTCHA_MODE=enforce');
    }

    if (this.mode !== 'off' && (!this.siteKey || !this.secretKey)) {
      this.logger.warn('CAPTCHA enabled but Turnstile keys are missing; verification will be skipped in monitor mode');
    }
  }

  getClientConfig() {
    const enabled = this.mode !== 'off' && !!this.siteKey;
    return {
      provider: 'turnstile' as const,
      mode: this.mode,
      enabled,
      required: this.mode === 'enforce',
      siteKey: enabled ? this.siteKey : null,
    };
  }

  async verifyOrThrow(input: VerifyCaptchaInput): Promise<void> {
    if (this.mode === 'off') return;
    if (this.mode === 'monitor' && (!this.siteKey || !this.secretKey)) return;

    const token = String(input.token || '').trim();
    const expectedAction = this.mapExpectedAction(input.action);

    if (!token) {
      if (this.mode === 'enforce') {
        throw new BadRequestException('CAPTCHA verification required');
      }
      this.logger.warn(`Missing CAPTCHA token for action=${input.action}`);
      return;
    }

    if (!this.secretKey) {
      if (this.mode === 'enforce') {
        throw new BadRequestException('CAPTCHA verification unavailable');
      }
      this.logger.warn(`Skipping CAPTCHA verification for action=${input.action}: TURNSTILE_SECRET_KEY is not configured`);
      return;
    }

    let verification: TurnstileVerifyResponse;
    try {
      verification = await this.verifyWithTurnstile(token, input.remoteIp || undefined);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (this.mode === 'enforce') {
        throw new BadRequestException('CAPTCHA verification failed');
      }
      this.logger.warn(`Turnstile verify failed for action=${input.action}: ${msg}`);
      return;
    }

    const errors = (verification['error-codes'] || []).join(',');
    if (!verification.success) {
      if (this.mode === 'enforce') {
        throw new BadRequestException('CAPTCHA verification failed');
      }
      this.logger.warn(`Turnstile rejected token for action=${input.action}; errors=${errors || 'none'}`);
      return;
    }

    if (verification.action && !this.isExpectedAction(verification.action, expectedAction)) {
      if (this.mode === 'enforce') {
        throw new BadRequestException('CAPTCHA action mismatch');
      }
      this.logger.warn(
        `Turnstile action mismatch for action=${input.action}; expected=${expectedAction}; received=${verification.action}`,
      );
    }
  }

  private resolveMode(): CaptchaMode {
    const raw = String(process.env.CAPTCHA_MODE || '').trim().toLowerCase();
    if (raw === 'off' || raw === 'monitor' || raw === 'enforce') {
      return raw;
    }
    // Single-tenant installs serve no public sign-up or contact pages: the CAPTCHA stays off
    // unless CAPTCHA_MODE asks for it.
    if (Features.SINGLE_TENANT) return 'off';
    return isProductionEnv() ? 'enforce' : 'off';
  }

  private mapExpectedAction(action: CaptchaAction): string {
    if (action === 'start-trial') return 'start_trial';
    if (action === 'support-invoice') return 'support_invoice';
    return 'contact';
  }

  private isExpectedAction(received: string, expected: string): boolean {
    if (!received || !expected) return false;
    if (received === expected) return true;
    // Backward compatibility for cached frontends using '-' instead of '_'
    const normalisedReceived = received.trim().toLowerCase().replace(/[-\s]+/g, '_');
    const normalisedExpected = expected.trim().toLowerCase().replace(/[-\s]+/g, '_');
    return normalisedReceived === normalisedExpected;
  }

  private async verifyWithTurnstile(token: string, remoteIp?: string): Promise<TurnstileVerifyResponse> {
    const form = new URLSearchParams();
    form.set('secret', this.secretKey);
    form.set('response', token);
    if (remoteIp) form.set('remoteip', remoteIp);

    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });

    if (!response.ok) {
      throw new Error(`Turnstile HTTP ${response.status}`);
    }

    const data = await response.json();
    return data as TurnstileVerifyResponse;
  }
}
