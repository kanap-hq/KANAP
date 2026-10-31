import { BadRequestException, Body, Controller, Get, InternalServerErrorException, Logger, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Features } from '../config/features';
import { throwNotAvailableInMode } from '../common/feature-gates';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsISO31661Alpha2, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes, createHash } from 'crypto';
import { Repository } from 'typeorm';
import { TenantsService } from '../tenants/tenants.service';
import { UsersService } from '../users/users.service';
import { buildStartingCompanyName, TenantBaselineService } from '../tenants/tenant-baseline.service';
import { DataSource } from 'typeorm';
import { TrialSignup } from './trial-signup.entity';
import { EmailService } from '../email/email.service';
import { AuthService } from '../auth/auth.service';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { RATE_LIMITS } from '../common/rate-limit';
import { clientAddress } from '../common/client-address';
import { withTenant } from '../common/tenant-runner';
import { TurnstileService } from './turnstile.service';
import { Subscription, SubscriptionStatus } from '../billing/subscription.entity';
import { INVOICE_PAYMENT_TERM_DAYS, TRIAL_PERIOD_DAYS } from '../billing/plans.config';
import { StripeClientService, ensureInvoiceA4 } from '../billing/stripe';
import {
  euVatTaxIdValue,
  isEuCountry,
  isValidEuVatNumber,
  normaliseVatNumber,
  stripeAddress,
  toIsoCountry,
} from '../billing/billing-profile.util';
import { customerSiren, invoiceCustomFields, invoiceLocale } from '../billing/invoice-mentions';
import { GTC_VERSION } from '../billing/terms';
import { isReservedTenantSlug, normalizeTenantSlug } from '../tenants/tenant-slug-policy';
import { StorageService } from '../common/storage/storage.service';
import { Response } from 'express';
import {
  buildActivationEmail,
  buildContactFormEmail,
  buildSupportRequestEmail,
  buildNewTenantNotificationEmail,
} from '../notifications/notification-templates';
import { resolveEmailLocale } from '../i18n/email-i18n';
import { resolveSeedLanguage } from '../analytics/recommended-dimensions.seed';
import { developmentRequestOrigin, resolveTenantAppBaseUrl } from '../common/url';
import { DemoDataService } from '../demo-data/demo-data.service';

/** The answer of a trial sign-up when the address of the public website is not configured. */
export const MARKETING_URL_NOT_CONFIGURED_MESSAGE = 'marketing URL is not configured: set MARKETING_BASE_URL';

const STRIPE_EU_BANK_TRANSFER_COUNTRIES = new Set<string>(['BE', 'DE', 'ES', 'FR', 'IE', 'NL']);
const STRIPE_DEFAULT_EU_BANK_TRANSFER_COUNTRY = 'FR';

/** Trims an optional text field; an empty string counts as absent. */
const optionalText = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  return text === '' ? undefined : text;
};

/**
 * A person name (first or last name of the trial sign-up): words of letters of any language,
 * combining marks, straight or typographic apostrophes and hyphens, each word may end with a
 * dot, words separated by single spaces. No digits, no `/`, `:` or `@`, no line break or tab:
 * the first name greets the person in the activation e-mail, sent to any address.
 */
export const PERSON_NAME = /^[\p{L}\p{M}][\p{L}\p{M}'’-]*\.?(?: [\p{L}\p{M}'’-]+\.?)*$/u;

/**
 * The trial sign-up form. The names are optional: the public website is
 * deployed apart from the API, and a form without them keeps working.
 */
export class StartTrialDto {
  @IsString()
  @MinLength(2)
  @IsOptional()
  org?: string;

  @IsString()
  @MinLength(2)
  @IsOptional()
  org_name?: string;

  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  slug!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @Matches(/^([A-Z]{2}|OTHER)$/)
  country_iso!: string;

  @IsString()
  @IsOptional()
  captchaToken?: string;

  @IsString()
  @IsOptional()
  captcha_token?: string;

  @Transform(optionalText)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(PERSON_NAME, { message: 'first_name must be a person name' })
  first_name?: string;

  @Transform(optionalText)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(PERSON_NAME, { message: 'last_name must be a person name' })
  last_name?: string;
}

export class ActivateTrialDto {
  @IsString()
  token!: string;
}

export class SendContactDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  company!: string;

  @IsString()
  @MinLength(10)
  message!: string;

  @IsString()
  @IsOptional()
  captchaToken?: string;

  @IsString()
  @IsOptional()
  captcha_token?: string;
}

/** Trims a string body field; other values are left for the validators to refuse. */
const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * The Enterprise Support invoice form (/offer). The invoice needs the full billing address
 * with an ISO country code; a company in the EU also needs a valid VAT number, checked by
 * the route with the rule of the tenant invoice details (billing-profile.util.ts).
 */
export class RequestSupportInvoiceDto {
  @Transform(trimmed)
  @IsString()
  @MinLength(2)
  company_name!: string;

  @Transform(trimmed)
  @IsString()
  @MinLength(2)
  contact_name!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  billing_email!: string;

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  address_line1!: string;

  @Transform(trimmed)
  @IsString()
  @IsOptional()
  address_line2?: string;

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  city!: string;

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  postal_code!: string;

  /** ISO 3166-1 alpha-2 ("fr" is read as "FR"; "FRANCE" is refused). */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsISO31661Alpha2()
  country!: string;

  @Transform(trimmed)
  @IsString()
  @IsOptional()
  vat_id?: string;

  /** The version of the general terms of sale the requester accepted (GTC_VERSION). */
  @IsString()
  @IsNotEmpty()
  terms_version!: string;

  @IsString()
  @IsOptional()
  captchaToken?: string;

  @IsString()
  @IsOptional()
  captcha_token?: string;
}

/** A support invoice request after normalisation: exactly what is sent to Stripe. */
type SupportInvoiceRequest = {
  company: string;
  contact: string;
  email: string;
  address: { line1: string; line2: string | null; city: string; postalCode: string; country: string };
  vatNumber: string | null;
};

@Controller('public')
export class PublicController {
  private readonly logger = new Logger(PublicController.name);

  constructor(
    private readonly tenants: TenantsService,
    private readonly users: UsersService,
    private readonly baseline: TenantBaselineService,
    private readonly dataSource: DataSource,
    private readonly emails: EmailService,
    private readonly auth: AuthService,
    @InjectRepository(TrialSignup)
    private readonly trialSignups: Repository<TrialSignup>,
    private readonly turnstile: TurnstileService,
    private readonly stripeClient: StripeClientService,
    private readonly storage: StorageService,
    private readonly demoData: DemoDataService,
  ) {}

  @Get('tenant-info')
  async tenantInfo(@Req() req: any) {
    if (req?.isPlatformHost) {
      return { platform: true };
    }
    const tenant = req?.tenant;
    if (tenant?.id) {
      const detail = await this.tenants.findById(tenant.id);
      const branding = this.normalizeBrandingPayload(detail?.branding);
      return {
        slug: tenant.slug,
        name: detail?.name ?? tenant.slug,
        logoPath: branding.logo_storage_path ? '/public/branding/logo' : null,
        logoVersion: branding.logo_storage_path ? branding.logo_version : null,
        useLogoInDark: branding.use_logo_in_dark,
        primaryColorLight: branding.primary_color_light,
        primaryColorDark: branding.primary_color_dark,
      };
    }
    return { marketing: true };
  }

  @Get('branding/logo')
  async serveBrandingLogo(@Req() req: any, @Res() res: Response): Promise<void> {
    if (req?.isPlatformHost) {
      res.status(404).send('Not found');
      return;
    }

    const tenantMeta = req?.tenant;
    if (!tenantMeta?.id) {
      res.status(404).send('Not found');
      return;
    }

    const tenant = await this.tenants.findById(tenantMeta.id);
    const branding = this.normalizeBrandingPayload(tenant?.branding);
    if (!branding.logo_storage_path) {
      res.status(404).send('Not found');
      return;
    }

    try {
      const obj = await this.storage.getObjectStream(branding.logo_storage_path);
      res.setHeader('Content-Type', obj.contentType || 'application/octet-stream');
      if (obj.contentLength != null) {
        res.setHeader('Content-Length', String(obj.contentLength));
      }
      res.setHeader('Cache-Control', 'public, max-age=300');
      obj.stream.pipe(res);
    } catch (error: any) {
      if (this.isStorageNotFoundError(error)) {
        res.status(404).send('Not found');
        return;
      }
      throw error;
    }
  }

  @Get('captcha-config')
  getCaptchaConfig() {
    return this.turnstile.getClientConfig();
  }

  @Post('start-trial')
  @UseGuards(RateLimitGuard)
  @Throttle({ default: RATE_LIMITS.publicStartTrial })
  async startTrial(@Body() body: StartTrialDto, @Req() req: any) {
    if (Features.SINGLE_TENANT) throwNotAvailableInMode();
    // The activation link base comes from the configuration and is checked first: without it
    // nothing is saved or sent, and every sign-up gets the same answer.
    const marketingBaseUrl = this.resolveMarketingBaseUrl(req);
    await this.turnstile.verifyOrThrow({
      token: this.resolveCaptchaToken(body),
      remoteIp: clientAddress(req),
      action: 'start-trial',
    });

    const org = String(body.org ?? body.org_name ?? '').trim();
    if (org.length < 2) {
      throw new BadRequestException({ code: 'INVALID_ORG', message: 'Organization name is required' });
    }
    const slug = normalizeTenantSlug(body.slug);
    const email = body.email.trim().toLowerCase();
    const requestedCountryIso = body.country_iso.trim().toUpperCase();
    const countryIso = requestedCountryIso === 'OTHER' ? null : requestedCountryIso;
    const firstName = this.optionalName(body.first_name);
    const lastName = this.optionalName(body.last_name);

    if (isReservedTenantSlug(slug)) {
      throw new BadRequestException({ code: 'SUBDOMAIN_NOT_AVAILABLE', message: 'Slug not available' });
    }

    // Only block if a non-deleted tenant currently owns the slug
    const existingTenant = await this.tenants.findBySlug(slug);
    if (existingTenant) {
      throw new BadRequestException({ code: 'SUBDOMAIN_NOT_AVAILABLE', message: 'Slug not available' });
    }

    // Reuse existing signup record even if it was previously activated.
    // This enables re-starting a trial after a tenant deletion for the same slug.
    let signup = await this.trialSignups.findOne({ where: { slug } });

    const token = randomBytes(32).toString('hex');
    const hash = this.hashToken(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.trialLinkTtlMs());

    if (!signup) {
      signup = this.trialSignups.create({
        org_name: org,
        slug,
        email,
        country_iso: countryIso,
        token_hash: hash,
        expires_at: expiresAt,
        last_email_sent_at: now,
        activated_at: null,
        first_name: firstName,
        last_name: lastName,
      });
    } else {
      signup.org_name = org;
      signup.email = email;
      signup.country_iso = countryIso;
      signup.token_hash = hash;
      signup.expires_at = expiresAt;
      signup.last_email_sent_at = now;
      signup.activated_at = null;
      signup.first_name = firstName;
      signup.last_name = lastName;
    }

    await this.trialSignups.save(signup);

    const activationUrl = `${marketingBaseUrl}/activate.html#token=${token}`;
    const emailLocale = this.resolveActivationEmailLocale(req);

    try {
      const activation = buildActivationEmail({
        greeting: firstName ?? this.nameFromEmail(email, org),
        activationUrl,
        locale: emailLocale,
      });
      await this.emails.send({
        to: email,
        subject: activation.subject,
        html: activation.html,
        text: activation.text,
        attachments: activation.attachments,
      });
    } catch (error: any) {
      if (error?.code === 'FEATURE_DISABLED') {
        return { ok: true, activation_url: activationUrl };
      }
      throw error;
    }

    return { ok: true };
  }

  @Post('contact')
  @UseGuards(RateLimitGuard)
  @Throttle({ default: RATE_LIMITS.publicContact })
  async sendContact(@Body() body: SendContactDto, @Req() req: any) {
    if (Features.SINGLE_TENANT) throwNotAvailableInMode();
    await this.turnstile.verifyOrThrow({
      token: this.resolveCaptchaToken(body),
      remoteIp: clientAddress(req),
      action: 'contact',
    });

    const name = body.name.trim();
    const email = body.email.trim().toLowerCase();
    const company = body.company.trim();
    const message = body.message.trim();

    const content = buildContactFormEmail({ name, email, company, message });
    await this.emails.send({
      to: 'support@kanap.net',
      subject: content.subject,
      html: content.html,
      text: content.text,
      replyTo: email,
      attachments: content.attachments,
    });

    return { ok: true };
  }

  @Post('request-support-invoice')
  @UseGuards(RateLimitGuard)
  @Throttle({ default: RATE_LIMITS.publicRequestSupportInvoice })
  async requestSupportInvoice(@Body() body: RequestSupportInvoiceDto, @Req() req: any) {
    if (Features.SINGLE_TENANT) throwNotAvailableInMode();
    // Checked before the CAPTCHA (its token is single use) and before any Stripe call.
    const request = this.validateSupportInvoiceRequest(body);
    await this.turnstile.verifyOrThrow({
      token: this.resolveCaptchaToken(body),
      remoteIp: clientAddress(req),
      action: 'support-invoice',
    });

    const stripe = this.stripeClient.getClient();
    if (!stripe) throw new InternalServerErrorException('Stripe is not configured');
    const priceId = (process.env.STRIPE_PRICE_ENTERPRISE_SUPPORT_ANNUAL || '').trim();
    if (!priceId) throw new InternalServerErrorException('Enterprise Support price not configured');

    const country = request.address.country;
    const euBankTransferCountry = this.resolveEuBankTransferCountry(country);
    const idempotencyBase = this.supportInvoiceIdempotencyBase(request, priceId, euBankTransferCountry);
    const mentionsContact = { vatNumber: request.vatNumber, address: { country } };
    const siren = customerSiren(mentionsContact);
    const euVat = euVatTaxIdValue({ vatNumber: request.vatNumber, address: request.address });

    let customer: any;
    try {
      customer = await stripe.customers.create(
        {
          name: request.company,
          email: request.email,
          metadata: {
            contact_name: request.contact,
            billing_channel: 'enterprise-support',
            ...(siren ? { siren } : {}),
          },
          address: stripeAddress(request.address),
          invoice_settings: { custom_fields: invoiceCustomFields(mentionsContact) },
          preferred_locales: [invoiceLocale(country)],
          ...(euVat ? { tax_id_data: [{ type: 'eu_vat' as const, value: euVat }] } : {}),
        },
        { idempotencyKey: `${idempotencyBase}-customer` },
      );
      // GTC art. 2: the acceptance is kept on the customer. This route has no tenant, and the
      // audit log is tenant-scoped (RLS), so it cannot hold it. A retry writes its own moment.
      await stripe.customers.update(customer.id, {
        metadata: { gtc_version: GTC_VERSION, gtc_accepted_at: new Date().toISOString() },
      });
    } catch (error: any) {
      this.throwSupportInvoiceStripeError(error);
    }

    let subscription: any;
    try {
      subscription = await stripe.subscriptions.create(
        {
          customer: customer.id,
          items: [{ price: priceId, quantity: 1 }],
          collection_method: 'send_invoice',
          days_until_due: INVOICE_PAYMENT_TERM_DAYS,
          payment_settings: this.buildSupportInvoicePaymentSettings(euBankTransferCountry),
          metadata: { billing_channel: 'enterprise-support', company_name: request.company },
          expand: ['latest_invoice'],
        },
        { idempotencyKey: `${idempotencyBase}-subscription` },
      );
    } catch (error: any) {
      this.throwSupportInvoiceStripeError(error);
    }

    const latestInvoice = await this.finalizeAndSendSupportInvoice(stripe, subscription?.latest_invoice);
    if (latestInvoice?.id) {
      this.logger.log(
        `Enterprise support invoice ${latestInvoice.id} created with card + bank transfer (country=${euBankTransferCountry})`,
      );
    }

    // Send admin notification email (if configured)
    const notifyEmail = process.env.ENTERPRISE_SUPPORT_NOTIFY_EMAIL;
    if (notifyEmail) {
      try {
        const supportContent = buildSupportRequestEmail({
          companyName: request.company,
          contactName: request.contact,
          billingEmail: request.email,
          country,
          vatId: request.vatNumber ?? undefined,
        });
        await this.emails.send({
          to: notifyEmail,
          subject: supportContent.subject,
          html: supportContent.html,
          text: supportContent.text,
          attachments: supportContent.attachments,
        });
      } catch (e: any) {
        if (e?.code !== 'FEATURE_DISABLED') {
          const msg = typeof e?.message === 'string' ? e.message : '';
          console.warn('[email] Failed to send enterprise support notification:', msg);
        }
      }
    }

    return {
      ok: true,
      hosted_invoice_url: latestInvoice?.hosted_invoice_url ?? null,
      invoice_number: latestInvoice?.number ?? null,
      invoice_status: latestInvoice?.status ?? null,
    };
  }

  @Post('activate-trial')
  async activateTrial(@Body() body: ActivateTrialDto, @Req() req: any) {
    if (Features.SINGLE_TENANT) throwNotAvailableInMode();
    const token = body.token?.trim();
    if (!token) throw new BadRequestException('token is required');

    const hash = this.hashToken(token);
    const signup = await this.trialSignups.findOne({ where: { token_hash: hash } });
    if (!signup) throw new BadRequestException('invalid or expired token');
    if (signup.activated_at) throw new BadRequestException('token already used');
    if (signup.expires_at && signup.expires_at.getTime() < Date.now()) {
      throw new BadRequestException('token expired');
    }
    // The new tenant's address, from the configuration (common/url.ts), before anything is written.
    const tenantUrl = resolveTenantAppBaseUrl(req, signup.slug);
    // The seeded dimensions take the language of the person who activates (their browser's).
    const language = resolveSeedLanguage(this.resolveActivationEmailLocale(req));

    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    let tenant: any;
    let owner: any;
    try {
      tenant = await this.tenants.findBySlug(signup.slug, { manager: runner.manager });
      if (tenant) throw new BadRequestException('Tenant already exists');

      tenant = await this.tenants.createTenant({ slug: signup.slug, name: signup.org_name, language }, { manager: runner.manager });

      await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);

      // The starting state (TenantBaselineService): the tenant defaults came with the tenant;
      // then the default global chart of accounts, the administrator, the starting company.
      await this.baseline.provisionDefaultGlobalCoa(runner.manager);

      const provisionalPassword = randomBytes(18).toString('base64url');
      owner = await this.users.createUser({
        email: signup.email,
        password: provisionalPassword,
        role_name: 'Administrator',
        tenant_id: tenant.id,
        first_name: signup.first_name ?? null,
        last_name: signup.last_name ?? null,
      }, { manager: runner.manager });

      await this.baseline.createStartingCompany(runner.manager, {
        companyName: buildStartingCompanyName(signup),
        countryIso: signup.country_iso || 'FR',
        actorId: owner.id,
      });

      await runner.manager.getRepository(TrialSignup).update(signup.id, {
        activated_at: new Date(),
        token_hash: null,
        expires_at: null,
      });

      // Create trial subscription (local only, no Stripe)
      await runner.manager.getRepository(Subscription).save({
        tenant_id: tenant.id,
        status: SubscriptionStatus.TRIALING,
        trial_end: new Date(Date.now() + TRIAL_PERIOD_DAYS * 86400000),
        plan_name: 'Trial',
        seat_limit: null, // unlimited during trial
        active_seats: 0,
      });

      await runner.commitTransaction();
    } catch (error) {
      try {
        await runner.rollbackTransaction();
      } catch {}
      throw error;
    } finally {
      try {
        await runner.release();
      } catch {}
    }

    // Fire-and-forget admin notification about tenant creation (non-blocking)
    try {
      const tenantNotif = buildNewTenantNotificationEmail({
        tenantName: tenant.name,
        slug: signup.slug,
        email: signup.email,
        countryIso: signup.country_iso || 'FR',
      });
      await this.emails.send({
        to: 'admin@kanap.net',
        subject: tenantNotif.subject,
        html: tenantNotif.html,
        text: tenantNotif.text,
        attachments: tenantNotif.attachments,
      });
    } catch (e: any) {
      if (e?.code !== 'FEATURE_DISABLED') {
        // Log but do not block activation response
        const msg = typeof e?.message === 'string' ? e.message : '';
        console.warn('[email] Failed to send new-tenant notification:', msg);
      }
    }

    const resetToken = await withTenant(this.dataSource, tenant.id, (manager) =>
      this.auth.createPasswordResetToken({ id: owner.id, email: owner.email, tenant_id: tenant.id }, manager),
    );

    // The sample data loads in the background (never rejects, not awaited): the person who sets
    // the password signs in to a workspace ready or loading, as the home banner shows.
    void this.demoData.provisionTrialSampleData({
      tenantId: tenant.id,
      actorId: owner.id,
      tenantUrl,
      language,
    });

    return { tenant_url: tenantUrl, reset_token: resetToken };
  }

  /**
   * Base URL of the trial activation link: `MARKETING_BASE_URL`. In development mode only, a
   * request on a local development host stands in for it (common/url.ts).
   */
  private resolveMarketingBaseUrl(req: any): string {
    const configured = String(process.env.MARKETING_BASE_URL || '').trim();
    if (configured) return configured.replace(/\/$/, '');
    const devOrigin = developmentRequestOrigin(req);
    if (devOrigin) return devOrigin;
    throw new BadRequestException(MARKETING_URL_NOT_CONFIGURED_MESSAGE);
  }

  private optionalName(value: unknown): string | null {
    const text = typeof value === 'string' ? value.trim() : '';
    return text || null;
  }

  private resolveCaptchaToken(body: { captchaToken?: string | null; captcha_token?: string | null }): string | undefined {
    return (body.captchaToken ?? body.captcha_token ?? undefined) || undefined;
  }

  private resolveActivationEmailLocale(req: any): string {
    const raw = String(req?.headers?.['accept-language'] ?? '').trim();
    if (!raw) return 'en';

    for (const part of raw.split(',')) {
      const candidate = part.split(';', 1)[0]?.trim();
      if (!candidate) continue;
      const resolved = resolveEmailLocale(candidate);
      if (resolved !== 'en' || candidate.toLowerCase().startsWith('en')) {
        return resolved;
      }
    }

    return 'en';
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  private trialLinkTtlMs() {
    return 1000 * 60 * 60 * 48; // 48 hours
  }

  private nameFromEmail(email: string, fallback?: string) {
    if (email && typeof email === 'string') {
      const local = email.split('@')[0] ?? '';
      if (local) {
        const token = local.split(/[._-]/)[0] ?? '';
        if (token) {
          return token.charAt(0).toUpperCase() + token.slice(1);
        }
      }
    }
    const base = (fallback && fallback.trim().split(/[\s]/)[0]) || 'there';
    return base.charAt(0).toUpperCase() + base.slice(1);
  }

  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (m) => map[m] || m);
  }

  /**
   * The support invoice request as it is sent to Stripe, after the checks the ValidationPipe
   * cannot make: the general terms of sale in their current version, and in the EU a VAT
   * number in the country's format (the rule of the tenant invoice details).
   */
  private validateSupportInvoiceRequest(body: RequestSupportInvoiceDto): SupportInvoiceRequest {
    if (body.terms_version !== GTC_VERSION) {
      throw new BadRequestException({
        code: 'TERMS_NOT_ACCEPTED',
        message: 'Accept the current general terms of sale to request the invoice.',
      });
    }
    const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
    const country = toIsoCountry(body.country);
    const line1 = text(body.address_line1);
    const city = text(body.city);
    const postalCode = text(body.postal_code);
    if (!country || !line1 || !city || !postalCode) {
      throw new BadRequestException({
        code: 'BILLING_ADDRESS_INCOMPLETE',
        message: 'Enter the full billing address: address line 1, postal code, city and country.',
      });
    }
    const vatNumber = normaliseVatNumber(body.vat_id) || null;
    if (isEuCountry(country) && !isValidEuVatNumber(country, vatNumber)) {
      throw new BadRequestException({
        code: 'VAT_NUMBER_INVALID',
        message: 'Enter a valid VAT number for the selected country. It is required in the European Union.',
      });
    }
    return {
      company: text(body.company_name),
      contact: text(body.contact_name),
      email: text(body.billing_email).toLowerCase(),
      address: { line1, line2: text(body.address_line2) || null, city, postalCode, country },
      vatNumber,
    };
  }

  /**
   * The base of the Stripe idempotency keys of one support invoice request. Stripe keeps a key
   * 24 hours and answers a repeated key with the first response, so a double click or a retry
   * gets the same customer and subscription back instead of new ones. The base follows
   * everything the request sends (Stripe refuses a known key with other parameters, so a
   * corrected form must be a new request) and the UTC day.
   */
  private supportInvoiceIdempotencyBase(request: SupportInvoiceRequest, priceId: string, bankTransferCountry: string): string {
    const payload = JSON.stringify({
      request,
      priceId,
      bankTransferCountry,
      termsVersion: GTC_VERSION,
      day: new Date().toISOString().slice(0, 10),
    });
    return `support-invoice-${createHash('sha256').update(payload).digest('hex')}`;
  }

  private extractInvoiceId(source: any): string | null {
    if (!source) return null;
    if (typeof source === 'string') return source;
    if (typeof source === 'object' && typeof source.id === 'string') return source.id;
    return null;
  }

  /**
   * Finalizes (A4 first) and sends the invoice of a new support subscription, once. The
   * invoice is read again: after an idempotent replay the subscription carries it as it was
   * at the first request. An invoice already finalized is returned as it is, never sent twice.
   */
  private async finalizeAndSendSupportInvoice(stripe: any, latestInvoice: any): Promise<any | null> {
    const invoiceId = this.extractInvoiceId(latestInvoice);
    if (!invoiceId) return null;

    let invoice: any = await stripe.invoices.retrieve(invoiceId);
    if (invoice?.status !== 'draft') return invoice;

    // The draft is set to A4 before Stripe renders its PDF.
    await ensureInvoiceA4(stripe, invoice, this.logger);
    try {
      invoice = await stripe.invoices.finalizeInvoice(invoiceId, { auto_advance: true });
    } catch (error) {
      // A concurrent identical request finalized it first: that request sends it.
      const current = await stripe.invoices.retrieve(invoiceId);
      if (current?.status && current.status !== 'draft') return current;
      throw error;
    }

    if (invoice?.collection_method === 'send_invoice' && invoice?.status === 'open') {
      try {
        invoice = await stripe.invoices.sendInvoice(invoiceId);
      } catch (error: any) {
        const msg = typeof error?.message === 'string' ? error.message : 'unknown';
        this.logger.warn(`Unable to send enterprise support invoice ${invoiceId}: ${msg}`);
      }
    }
    if (!invoice?.hosted_invoice_url) {
      try {
        invoice = await stripe.invoices.retrieve(invoiceId);
      } catch (error: any) {
        const msg = typeof error?.message === 'string' ? error.message : 'unknown';
        this.logger.warn(`Unable to refresh enterprise support invoice ${invoiceId}: ${msg}`);
      }
    }

    return invoice;
  }

  private buildSupportInvoicePaymentSettings(bankTransferCountry: string): any {
    return {
      payment_method_types: ['card', 'customer_balance'],
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

  private normalizeBrandingPayload(raw: Record<string, any> | null | undefined): {
    logo_storage_path?: string;
    logo_version: number;
    use_logo_in_dark: boolean;
    primary_color_light: string | null;
    primary_color_dark: string | null;
  } {
    const source = raw && typeof raw === 'object' ? raw : {};
    const logoVersion = Number(source.logo_version);
    return {
      logo_storage_path: typeof source.logo_storage_path === 'string' ? source.logo_storage_path : undefined,
      logo_version: Number.isFinite(logoVersion) && logoVersion >= 0 ? logoVersion : 0,
      use_logo_in_dark: source.use_logo_in_dark !== false,
      primary_color_light: typeof source.primary_color_light === 'string' ? source.primary_color_light : null,
      primary_color_dark: typeof source.primary_color_dark === 'string' ? source.primary_color_dark : null,
    };
  }

  private isStorageNotFoundError(error: any): boolean {
    const message = String(error?.message || '').toLowerCase();
    return (
      message.includes('nosuchkey')
      || message.includes('notfound')
      || message.includes('(404)')
    );
  }

  private throwSupportInvoiceStripeError(error: any): never {
    const rawMessage = typeof error?.message === 'string' ? error.message.trim() : '';
    const messageLower = rawMessage.toLowerCase();
    const code = typeof error?.code === 'string' ? error.code : '';

    if (messageLower.includes('eu_vat') || messageLower.includes('vat') || code === 'tax_id_invalid' || code === 'invalid_tax_id') {
      throw new BadRequestException({
        code: 'VAT_NUMBER_INVALID',
        message: 'Enter a valid VAT number for the selected country. It is required in the European Union.',
      });
    }
    if (code === 'email_invalid') {
      throw new BadRequestException('Invalid billing email address.');
    }
    if (rawMessage) {
      throw new BadRequestException(rawMessage);
    }
    throw new BadRequestException('Unable to create invoice request.');
  }
}
