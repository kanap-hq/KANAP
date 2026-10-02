import { Injectable, Logger } from '@nestjs/common';
import {
  buildActionButtons,
  buildEmailIntro,
  buildSurfacePanel,
  buildUrlPanel,
  emailWrapper,
} from '../notifications/notification-templates';
import { getEmailStrings, interpolate } from '../i18n/email-i18n';
import { DEFAULT_EMAIL_PRIMARY_COLOR, type EmailBranding } from './email-branding';
import { createEmailTransport } from './transports/email-transport.factory';
import type {
  DeliveryError,
  EmailRetryConfig,
  EmailTransport,
} from './transports/email-transport.interface';
import type { SendEmailOptions } from './email.types';

export type { EmailAttachment, Recipient, SendEmailOptions } from './email.types';

interface QueuedEmail {
  options: SendEmailOptions;
  resolve: () => void;
  reject: (err: Error) => void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transport: EmailTransport;
  private readonly emailOverride: string | null;

  // Queue + rate limiting, per API process (with several processes each paces its own queue;
  // Resend 429 answers are retried). A stop waits for the queue to empty (`drain`).
  private emailQueue: QueuedEmail[] = [];
  private isProcessingQueue = false;
  private nextSendAtMs = 0;

  private readonly RATE_LIMIT_DELAY_MS: number;
  private readonly RATE_LIMIT_MAX_RETRIES: number;
  private readonly RETRY_CONFIG: EmailRetryConfig;

  constructor() {
    this.transport = createEmailTransport(this.logger);
    this.emailOverride = process.env.EMAIL_OVERRIDE?.trim() || null;
    this.RATE_LIMIT_DELAY_MS = this.readPositiveIntEnv(
      'EMAIL_QUEUE_MIN_INTERVAL_MS',
      this.transport.defaultMinIntervalMs,
    );
    this.RATE_LIMIT_MAX_RETRIES = this.readPositiveIntEnv('EMAIL_RATE_LIMIT_MAX_RETRIES', 5);
    this.RETRY_CONFIG = {
      baseMs: this.readPositiveIntEnv('EMAIL_RATE_LIMIT_RETRY_BASE_MS', 1_500),
      maxMs: this.readPositiveIntEnv('EMAIL_RATE_LIMIT_RETRY_MAX_MS', 30_000),
      jitterMs: this.readPositiveIntEnv('EMAIL_RATE_LIMIT_RETRY_JITTER_MS', 250),
    };

    if (this.emailOverride) {
      this.logger.warn(`Email override active: all emails will be sent to ${this.emailOverride}`);
    }
  }

  async send(options: SendEmailOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      this.emailQueue.push({ options, resolve, reject });
      void this.processQueue();
    });
  }

  /** Emails queued or being sent. */
  pendingCount(): number {
    return this.emailQueue.length + (this.isProcessingQueue ? 1 : 0);
  }

  /**
   * At a stop (main.ts): waits until the queued emails are sent, or `deadlineAt` (ms) passes.
   * Returns how many were left unsent, logged: the process is about to exit and they are lost.
   */
  async drain(deadlineAt: number): Promise<number> {
    while (this.pendingCount() > 0 && Date.now() < deadlineAt) {
      await sleep(Math.min(50, Math.max(1, deadlineAt - Date.now())));
    }
    const left = this.pendingCount();
    if (left > 0) {
      this.logger.warn(`${left} email(s) not sent: the API process stopped before the queue emptied`);
    }
    return left;
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    try {
      while (this.emailQueue.length > 0) {
        const item = this.emailQueue.shift()!;
        try {
          await this.sendWithRateLimitRetry(item.options);
          item.resolve();
        } catch (err) {
          item.reject(this.normalizeError(err));
        }
      }
    } finally {
      this.isProcessingQueue = false;
      if (this.emailQueue.length > 0) {
        void this.processQueue();
      }
    }
  }

  private async sendWithRateLimitRetry(options: SendEmailOptions): Promise<void> {
    let attempt = 0;
    while (true) {
      await this.waitForSendSlot();
      try {
        await this.sendImmediate(options);
        return;
      } catch (err) {
        const normalized = this.normalizeError(err);
        const retryDelayMs = this.transport.getRetryDelayMs(normalized, attempt, this.RETRY_CONFIG);
        if (retryDelayMs === null || attempt >= this.RATE_LIMIT_MAX_RETRIES) {
          throw normalized;
        }

        attempt += 1;
        const to = Array.isArray(options.to) ? options.to.join(', ') : options.to;
        this.logger.warn(
          `${this.transport.name} delivery throttled for ${to}; retry ${attempt}/${this.RATE_LIMIT_MAX_RETRIES} in ${retryDelayMs}ms`,
        );

        this.deferNextSendUntil(Date.now() + retryDelayMs);
        await sleep(retryDelayMs);
      }
    }
  }

  private async waitForSendSlot(): Promise<void> {
    const now = Date.now();
    const waitMs = this.nextSendAtMs - now;
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    this.nextSendAtMs = Date.now() + this.RATE_LIMIT_DELAY_MS;
  }

  private deferNextSendUntil(timestampMs: number): void {
    this.nextSendAtMs = Math.max(this.nextSendAtMs, timestampMs);
  }

  private async sendImmediate(options: SendEmailOptions): Promise<void> {
    const originalTo = Array.isArray(options.to) ? options.to : [options.to];

    let resolved = options;
    if (this.emailOverride) {
      resolved = {
        ...options,
        to: [this.emailOverride],
        subject: `[To: ${originalTo.join(', ')}] ${options.subject}`,
      };
      this.logger.debug(`Email redirected from ${originalTo.join(', ')} to ${this.emailOverride}`);
    }

    const finalTo = Array.isArray(resolved.to) ? resolved.to.join(', ') : resolved.to;
    this.logger.debug(`Sending email via ${this.transport.name} to ${finalTo}: ${resolved.subject}`);
    await this.transport.send(resolved);
  }

  async sendPasswordResetEmail(params: {
    to: string;
    resetUrl: string;
    expiresInMinutes?: number;
    branding?: EmailBranding;
    locale?: string;
  }) {
    const strings = getEmailStrings(params.locale);
    const expires = params.expiresInMinutes ?? 60;
    const branding = params.branding;
    const pc = branding?.primaryColor ?? DEFAULT_EMAIL_PRIMARY_COLOR;
    const subject = strings.auth.passwordReset.subject;
    const baseUrl = params.resetUrl.match(/^(https?:\/\/[^/]+)/)?.[1] || '';
    const preferencesUrl = baseUrl ? baseUrl + '/settings/notifications' : undefined;
    const body = `
      ${buildEmailIntro({
        title: subject,
        summaryHtml: `<p style="margin:0 0 10px 0;">${strings.common.labels.greetingHello}</p><p style="margin:0;">${strings.auth.passwordReset.intro}</p>`,
      })}
      ${buildActionButtons([{ label: strings.common.buttons.resetPassword, url: params.resetUrl }], pc)}
      ${buildUrlPanel(strings.auth.passwordReset.copyPaste, params.resetUrl, pc)}
      ${buildSurfacePanel({
        marginTop: 20,
        tone: 'warning',
        contentHtml: `<p style="margin:0;">${interpolate(strings.auth.passwordReset.expires, { minutes: expires })}</p>`,
      })}
    `;
    const wrapper = emailWrapper(body, { preferencesUrl, branding, locale: params.locale });
    const text = [
      strings.common.labels.greetingHello,
      strings.auth.passwordReset.intro,
      interpolate(strings.auth.passwordReset.textAction, { url: params.resetUrl }),
      interpolate(strings.auth.passwordReset.expires, { minutes: expires }),
      preferencesUrl
        ? interpolate(strings.common.footer.managePreferencesText, { url: preferencesUrl })
        : null,
    ].filter(Boolean).join('\n\n');
    await this.send({ to: params.to, subject, html: wrapper.html, text, attachments: wrapper.attachments });
  }

  async sendUserInviteEmail(params: {
    to: string;
    inviteUrl: string;
    expiresInMinutes?: number;
    roleName?: string | null;
    inviterEmail?: string | null;
    branding?: EmailBranding;
    locale?: string;
  }) {
    const strings = getEmailStrings(params.locale);
    const expires = params.expiresInMinutes ?? 60;
    const branding = params.branding;
    const pc = branding?.primaryColor ?? DEFAULT_EMAIL_PRIMARY_COLOR;
    const subject = strings.auth.userInvite.subject;
    const roleLine = params.roleName
      ? interpolate(strings.auth.userInvite.rolePart, {
        roleName: escapeHtml(params.roleName),
      })
      : '';
    const inviterLine = params.inviterEmail
      ? interpolate(strings.auth.userInvite.inviterPart, {
        inviterEmail: escapeHtml(params.inviterEmail),
      })
      : '';
    const roleLineText = params.roleName
      ? interpolate(strings.auth.userInvite.rolePart, { roleName: params.roleName })
      : '';
    const inviterLineText = params.inviterEmail
      ? interpolate(strings.auth.userInvite.inviterPart, { inviterEmail: params.inviterEmail })
      : '';
    const baseUrl = params.inviteUrl.match(/^(https?:\/\/[^/]+)/)?.[1] || '';
    const preferencesUrl = baseUrl ? baseUrl + '/settings/notifications' : undefined;
    const body = `
      ${buildEmailIntro({
        title: subject,
        summaryHtml: `<p style="margin:0 0 10px 0;">${strings.common.labels.greetingHello}</p><p style="margin:0;">${interpolate(strings.auth.userInvite.intro, {
          inviterPart: inviterLine,
          rolePart: roleLine,
        })}</p>`,
      })}
      ${buildActionButtons([{ label: strings.common.buttons.setPassword, url: params.inviteUrl }], pc)}
      ${buildUrlPanel(strings.auth.userInvite.copyPaste, params.inviteUrl, pc)}
      ${buildSurfacePanel({
        marginTop: 20,
        tone: 'info',
        contentHtml: `<p style="margin:0;">${interpolate(strings.auth.userInvite.expires, { minutes: expires })}</p>`,
      })}
    `;
    const wrapper = emailWrapper(body, { preferencesUrl, branding, locale: params.locale });
    const text = [
      strings.common.labels.greetingHello,
      interpolate(strings.auth.userInvite.intro, {
        inviterPart: inviterLineText,
        rolePart: roleLineText,
      }),
      interpolate(strings.auth.userInvite.textAction, { url: params.inviteUrl }),
      interpolate(strings.auth.userInvite.expires, { minutes: expires }),
      preferencesUrl
        ? interpolate(strings.common.footer.managePreferencesText, { url: preferencesUrl })
        : null,
    ].filter(Boolean).join('\n\n');
    await this.send({ to: params.to, subject, html: wrapper.html, text, attachments: wrapper.attachments });
  }

  private normalizeError(err: unknown): DeliveryError {
    if (err instanceof Error) return err as DeliveryError;
    if (typeof err === 'string') return new Error(err) as DeliveryError;

    if (err && typeof err === 'object') {
      const source = err as {
        name?: unknown;
        message?: unknown;
        code?: unknown;
        responseCode?: unknown;
      };
      const error = new Error(
        typeof source.message === 'string' ? source.message : 'Unknown email send error',
      ) as DeliveryError;
      if (typeof source.name === 'string') error.name = source.name;
      if (typeof source.code === 'string') error.code = source.code;
      if (typeof source.responseCode === 'number') error.responseCode = source.responseCode;
      return error;
    }

    return new Error('Unknown email send error') as DeliveryError;
  }

  private readPositiveIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw || raw.trim().length === 0) return fallback;

    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      this.logger.warn(`${name} is invalid (${raw}); using default ${fallback}`);
      return fallback;
    }
    return parsed;
  }
}
