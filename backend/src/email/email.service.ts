import { Injectable, Logger, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  buildActionButtons,
  buildEmailIntro,
  buildParagraphs,
  buildSurfacePanel,
  buildUrlPanel,
  emailWorkspaceName,
  emailWrapper,
  formatEmailDuration,
} from '../notifications/notification-templates';
import { getEmailStrings, interpolate } from '../i18n/email-i18n';
import type { EmailStrings } from '../i18n/email-locales/en';
import { DEFAULT_EMAIL_PRIMARY_COLOR, loadTenantEmailBranding, type EmailBranding } from './email-branding';
import { workspaceEmailSender } from './email-config';
import { StorageService } from '../common/storage/storage.service';
import { createEmailTransport } from './transports/email-transport.factory';
import type {
  DeliveryError,
  EmailRetryConfig,
  EmailTransport,
} from './transports/email-transport.interface';
import type { Recipient, SendEmailOptions } from './email.types';
import { findAddressTokens, replaceAddressTokens } from '../common/text-scan';

export type { EmailAttachment, Recipient, SendEmailOptions } from './email.types';

interface QueuedEmail {
  options: SendEmailOptions;
  resolve: () => void;
  reject: (err: Error) => void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Whether a recipient entry holds an address on a reserved `.example` domain (RFC 2606). The
 * demo users (`fromage-co.example`, ...) live on such domains: no e-mail is ever sent to them.
 * An entry carrying several addresses is left out whole when one of them is reserved.
 */
export function isExampleRecipient(entry: unknown): boolean {
  const addresses = findAddressTokens(String(entry ?? ''));
  return addresses.some((address) => {
    const domain = address.slice(address.lastIndexOf('@') + 1).trim().toLowerCase().replace(/\.+$/, '');
    return domain === 'example' || domain.endsWith('.example');
  });
}

/** `text` with every e-mail address replaced by `[address]`, for a log line. */
export function maskEmailAddresses(text: string): string {
  return replaceAddressTokens(text, '[address]');
}

/** "Hello Claire," or "Hello," without a first name. */
function greetingOf(strings: EmailStrings, firstName: string | null | undefined): string {
  const name = firstName?.trim();
  return name ? interpolate(strings.common.labels.greetingHelloName, { name }) : strings.common.labels.greetingHello;
}

/** How many recipient entries an e-mail names. A log line prints this count, never the addresses. */
function recipientCount(to: Recipient): number {
  return Array.isArray(to) ? to.length : 1;
}

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

  constructor(
    @Optional() private readonly dataSource?: DataSource,
    @Optional() private readonly storage?: StorageService,
  ) {
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
      this.logger.warn('Email override active: all emails will be sent to the override address');
    }
  }

  /**
   * Queues an e-mail. Recipients on a reserved `.example` domain are left out first, before
   * `EMAIL_OVERRIDE` applies; when none is left, nothing is sent and the call resolves.
   */
  async send(options: SendEmailOptions): Promise<void> {
    const to = Array.isArray(options.to) ? options.to : [options.to];
    const kept = to.filter((entry) => !isExampleRecipient(entry));
    if (kept.length < to.length) {
      if (kept.length === 0) {
        this.logger.log(`E-mail not sent: its ${to.length} recipient(s) are on reserved .example domains`);
        return;
      }
      this.logger.log(`${to.length - kept.length} recipient(s) on reserved .example domains left out of an e-mail`);
      options = { ...options, to: kept };
    }
    return new Promise((resolve, reject) => {
      this.emailQueue.push({ options, resolve, reject });
      void this.processQueue();
    });
  }

  /** The transport in use (`smtp`, `resend`, `disabled`), for log lines about a failed send. */
  get transportName(): string {
    return this.transport.name;
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
        this.logger.warn(
          `${this.transport.name} delivery throttled for ${recipientCount(options.to)} recipient(s); retry ${attempt}/${this.RATE_LIMIT_MAX_RETRIES} in ${retryDelayMs}ms`,
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
      this.logger.debug('Email redirected to the override address');
    }

    this.logger.debug(
      `Sending email via ${this.transport.name} to ${recipientCount(resolved.to)} recipient(s)`,
    );
    await this.transport.send(resolved);
  }

  /** A tenant's e-mail branding (logo, colour, organisation name); the product's without a tenant. */
  async tenantBranding(tenantId: string | null | undefined): Promise<EmailBranding | undefined> {
    if (!tenantId || !this.dataSource || !this.storage) return undefined;
    return loadTenantEmailBranding((sql, values) => this.dataSource!.query(sql, values), this.storage, tenantId);
  }

  async sendPasswordResetEmail(params: {
    to: string;
    resetUrl: string;
    expiresInMinutes?: number;
    firstName?: string | null;
    branding?: EmailBranding;
    /** The tenant whose branding and organisation name the e-mail takes, when `branding` is not given. */
    tenantId?: string | null;
    locale?: string;
  }) {
    const strings = getEmailStrings(params.locale);
    const s = strings.auth.passwordReset;
    const branding = params.branding ?? await this.tenantBranding(params.tenantId);
    const pc = branding?.primaryColor ?? DEFAULT_EMAIL_PRIMARY_COLOR;
    const subject = interpolate(s.subject, { organisation: emailWorkspaceName(branding) });
    const greeting = greetingOf(strings, params.firstName);
    const intro = interpolate(s.intro, { duration: formatEmailDuration(params.expiresInMinutes ?? 60, params.locale) });
    const button = { label: strings.common.buttons.resetPassword, url: params.resetUrl };
    const body = `
      ${buildEmailIntro({ title: subject })}
      ${buildParagraphs([greeting, intro])}
      ${buildActionButtons([button], pc, { marginTop: 4 })}
      ${buildUrlPanel(strings.common.labels.copyLink, params.resetUrl, pc)}
      ${buildSurfacePanel({
        marginTop: 20,
        tone: 'warning',
        contentHtml: `<p style="margin:0;">${escapeHtml(s.ignore)}</p>`,
      })}
    `;
    // No notification preferences link: this e-mail is not a notification.
    const wrapper = emailWrapper(body, { branding, locale: params.locale });
    const text = [
      greeting,
      intro,
      interpolate(strings.common.labels.linkText, button),
      s.ignore,
    ].join('\n\n');
    const from = workspaceEmailSender(branding?.organisationName);
    await this.send({ to: params.to, subject, html: wrapper.html, text, attachments: wrapper.attachments, ...(from ? { from } : {}) });
  }

  async sendUserInviteEmail(params: {
    to: string;
    inviteUrl: string;
    expiresInMinutes?: number;
    firstName?: string | null;
    /** The administrator who invites, by name. */
    inviterName?: string | null;
    branding?: EmailBranding;
    /** The tenant whose branding and organisation name the e-mail takes, when `branding` is not given. */
    tenantId?: string | null;
    locale?: string;
  }) {
    const strings = getEmailStrings(params.locale);
    const s = strings.auth.userInvite;
    const branding = params.branding ?? await this.tenantBranding(params.tenantId);
    const pc = branding?.primaryColor ?? DEFAULT_EMAIL_PRIMARY_COLOR;
    const organisation = emailWorkspaceName(branding);
    const subject = interpolate(s.subject, { organisation });
    const greeting = greetingOf(strings, params.firstName);
    const place = branding?.organisationName ? interpolate(s.placeWorkspace, { organisation }) : s.placeProduct;
    const inviterName = params.inviterName?.trim();
    const intro = [
      inviterName ? interpolate(s.intro, { inviterName, place }) : interpolate(s.introNoInviter, { place }),
      interpolate(s.password, { duration: formatEmailDuration(params.expiresInMinutes ?? 60, params.locale) }),
    ].join(' ');
    const button = { label: strings.common.buttons.setPassword, url: params.inviteUrl };
    const body = `
      ${buildEmailIntro({ title: subject })}
      ${buildParagraphs([greeting, intro])}
      ${buildActionButtons([button], pc, { marginTop: 4 })}
      ${buildUrlPanel(strings.common.labels.copyLink, params.inviteUrl, pc)}
      <p style="margin:20px 0 14px 0;">${escapeHtml(s.signIn)}</p>
    `;
    // No notification preferences link: the person has no account to set them in yet.
    const wrapper = emailWrapper(body, { branding, locale: params.locale });
    const text = [
      greeting,
      intro,
      interpolate(strings.common.labels.linkText, button),
      s.signIn,
    ].join('\n\n');
    const from = workspaceEmailSender(branding?.organisationName);
    await this.send({ to: params.to, subject, html: wrapper.html, text, attachments: wrapper.attachments, ...(from ? { from } : {}) });
  }

  /**
   * The invitation of a person who signs in with Microsoft Entra: no link to set a password, a
   * button to the workspace address, where they choose "Sign in with Microsoft".
   */
  async sendUserMicrosoftInviteEmail(params: {
    to: string;
    /** The workspace address (the tenant's own address). */
    signInUrl: string;
    firstName?: string | null;
    inviterName?: string | null;
    branding?: EmailBranding;
    /** The tenant whose branding and organisation name the e-mail takes, when `branding` is not given. */
    tenantId?: string | null;
    locale?: string;
  }) {
    const strings = getEmailStrings(params.locale);
    const invite = strings.auth.userInviteMicrosoft;
    const branding = params.branding ?? await this.tenantBranding(params.tenantId);
    const pc = branding?.primaryColor ?? DEFAULT_EMAIL_PRIMARY_COLOR;
    const organisation = emailWorkspaceName(branding);
    const subject = interpolate(invite.subject, { organisation });
    const greeting = greetingOf(strings, params.firstName);
    const place = branding?.organisationName ? interpolate(invite.placeWorkspace, { organisation }) : invite.placeProduct;
    const inviterName = params.inviterName?.trim();
    const intro = inviterName ? interpolate(invite.intro, { inviterName, place }) : interpolate(invite.introNoInviter, { place });
    const button = { label: interpolate(strings.common.buttons.openWorkspace, { organisation }), url: params.signInUrl };
    const body = `
      ${buildEmailIntro({ title: subject })}
      ${buildParagraphs([greeting, intro, invite.signIn])}
      ${buildActionButtons([button], pc, { marginTop: 4 })}
      ${buildUrlPanel(invite.address, params.signInUrl, pc)}
    `;
    // No notification preferences link: the person has no account to set them in yet.
    const wrapper = emailWrapper(body, { branding, locale: params.locale });
    const text = [
      greeting,
      intro,
      invite.signIn,
      interpolate(invite.textAction, { organisation, url: params.signInUrl }),
    ].join('\n\n');
    const from = workspaceEmailSender(branding?.organisationName);
    await this.send({ to: params.to, subject, html: wrapper.html, text, attachments: wrapper.attachments, ...(from ? { from } : {}) });
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
