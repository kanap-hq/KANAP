import { BadRequestException, Body, Controller, Get, InternalServerErrorException, Logger, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Features } from '../config/features';
import { throwNotAvailableInMode } from '../common/feature-gates';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes, createHash } from 'crypto';
import { Repository } from 'typeorm';
import { TenantsService } from '../tenants/tenants.service';
import { UsersService } from '../users/users.service';
import { CompaniesService } from '../companies/companies.service';
import { ChartOfAccountsService } from '../accounts/chart-of-accounts.service';
import { DataSource } from 'typeorm';
import { TrialSignup } from './trial-signup.entity';
import { EmailService } from '../email/email.service';
import { AuthService } from '../auth/auth.service';
import { StatusState } from '../common/status';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { RATE_LIMITS } from '../common/rate-limit';
import { withTenant } from '../common/tenant-runner';
import { withSavepoint } from '../common/savepoint.util';
import { TurnstileService } from './turnstile.service';
import { Subscription, SubscriptionStatus } from '../billing/subscription.entity';
import { TRIAL_PERIOD_DAYS } from '../billing/plans.config';
import { StripeClientService } from '../billing/stripe';
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

const STRIPE_EU_BANK_TRANSFER_COUNTRIES = new Set<string>(['BE', 'DE', 'ES', 'FR', 'IE', 'NL']);
const STRIPE_DEFAULT_EU_BANK_TRANSFER_COUNTRY = 'FR';

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

export class RequestSupportInvoiceDto {
  @IsString()
  @MinLength(2)
  company_name!: string;

  @IsString()
  @MinLength(2)
  contact_name!: string;

  @IsEmail()
  billing_email!: string;

  @IsString()
  @IsOptional()
  address_line1?: string;

  @IsString()
  @IsOptional()
  address_line2?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  postal_code?: string;

  @IsString()
  @MinLength(2)
  country!: string;

  @IsString()
  @IsOptional()
  vat_id?: string;

  @IsString()
  @IsOptional()
  captchaToken?: string;

  @IsString()
  @IsOptional()
  captcha_token?: string;
}

@Controller('public')
export class PublicController {
  private readonly logger = new Logger(PublicController.name);

  constructor(
    private readonly tenants: TenantsService,
    private readonly users: UsersService,
    private readonly companies: CompaniesService,
    private readonly dataSource: DataSource,
    private readonly emails: EmailService,
    private readonly auth: AuthService,
    @InjectRepository(TrialSignup)
    private readonly trialSignups: Repository<TrialSignup>,
    private readonly coas: ChartOfAccountsService,
    private readonly turnstile: TurnstileService,
    private readonly stripeClient: StripeClientService,
    private readonly storage: StorageService,
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
    await this.turnstile.verifyOrThrow({
      token: this.resolveCaptchaToken(body),
      remoteIp: this.resolveClientIp(req),
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
      });
    } else {
      signup.org_name = org;
      signup.email = email;
      signup.country_iso = countryIso;
      signup.token_hash = hash;
      signup.expires_at = expiresAt;
      signup.last_email_sent_at = now;
      signup.activated_at = null;
    }

    await this.trialSignups.save(signup);

    const activationUrl = `${this.resolveMarketingBaseUrl(req)}/activate.html#token=${token}`;
    const emailLocale = this.resolveActivationEmailLocale(req);

    try {
      const activation = buildActivationEmail({
        greeting: this.nameFromEmail(email, org),
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
    await this.turnstile.verifyOrThrow({
      token: this.resolveCaptchaToken(body),
      remoteIp: this.resolveClientIp(req),
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
    await this.turnstile.verifyOrThrow({
      token: this.resolveCaptchaToken(body),
      remoteIp: this.resolveClientIp(req),
      action: 'support-invoice',
    });

    const stripe = this.stripeClient.getClient();
    if (!stripe) throw new InternalServerErrorException('Stripe is not configured');
    const priceId = (process.env.STRIPE_PRICE_ENTERPRISE_SUPPORT_ANNUAL || '').trim();
    if (!priceId) throw new InternalServerErrorException('Enterprise Support price not configured');

    let customer: any;
    try {
      customer = await stripe.customers.create({
        name: body.company_name,
        email: body.billing_email,
        metadata: {
          contact_name: body.contact_name,
          billing_channel: 'enterprise-support',
        },
        address: {
          line1: body.address_line1 || '',
          line2: body.address_line2 || '',
          city: body.city || '',
          postal_code: body.postal_code || '',
          country: body.country || '',
        },
        tax_id_data: body.vat_id ? [{ type: 'eu_vat' as const, value: body.vat_id }] : undefined,
      });
    } catch (error: any) {
      this.throwSupportInvoiceStripeError(error);
    }

    let subscription: any;
    const euBankTransferCountry = this.resolveEuBankTransferCountry(body.country);
    try {
      subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: priceId, quantity: 1 }],
        collection_method: 'send_invoice',
        days_until_due: 30,
        payment_settings: this.buildSupportInvoicePaymentSettings(euBankTransferCountry),
        metadata: { billing_channel: 'enterprise-support', company_name: body.company_name },
        expand: ['latest_invoice'],
      });
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
          companyName: body.company_name,
          contactName: body.contact_name,
          billingEmail: body.billing_email,
          country: body.country,
          vatId: body.vat_id,
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

    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    let tenant: any;
    let owner: any;
    try {
      tenant = await this.tenants.findBySlug(signup.slug, { manager: runner.manager });
      if (tenant) throw new BadRequestException('Tenant already exists');

      tenant = await this.tenants.createTenant({ slug: signup.slug, name: signup.org_name }, { manager: runner.manager });

      await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);

      // Provision default global CoA from platform template if available
      await this.provisionDefaultGlobalCoa(runner.manager);

      const provisionalPassword = randomBytes(18).toString('base64url');
      owner = await this.users.createUser({
        email: signup.email,
        password: provisionalPassword,
        role_name: 'Administrator',
        tenant_id: tenant.id,
      }, { manager: runner.manager });

      const companyName = this.buildCompanyName(signup);
      await this.companies.create({
        name: companyName,
        country_iso: (signup.country_iso || 'FR'),
        city: 'Unknown',
        status: StatusState.ENABLED,
      }, owner.id, { manager: runner.manager });

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

    const host = this.sanitizeForwardedHost((req.headers['x-forwarded-host'] as string) || (req.headers.host as string) || '');
    const proto = this.normalizeForwardedProto((req.headers['x-forwarded-proto'] as string) || req.protocol || 'http');
    const tenantUrl = this.computeTenantUrl(proto, host, signup.slug);
    const resetToken = await withTenant(this.dataSource, tenant.id, (manager) =>
      this.auth.createPasswordResetToken({ id: owner.id, email: owner.email, tenant_id: tenant.id }, manager),
    );

    return { tenant_url: tenantUrl, reset_token: resetToken };
  }

  // Create a tenant CoA from the single global template marked loaded_by_default, if present.
  // Under its own savepoint: a failure (a SQL error included) undoes the whole chart and leaves
  // the signup transaction usable, so tenant creation goes on without it.
  private async provisionDefaultGlobalCoa(manager: DataSource['manager']) {
    try {
      await withSavepoint(manager, async () => {
        const rows: Array<{ id: string; template_code: string; template_name: string }>
          = await manager.query(`SELECT id, template_code, template_name FROM coa_templates WHERE is_global = true AND loaded_by_default = true LIMIT 1`);
        const tmpl = rows?.[0];
        if (!tmpl) return;
        // Create tenant CoA from a global template with GLOBAL scope (no country), not country-default
        const created = await this.coas.create({ code: tmpl.template_code, name: tmpl.template_name, scope: 'GLOBAL', is_default: false }, null, { manager });
        // Copy accounts into CoA
        await this.coas.loadTemplateIntoCoa(created.id, tmpl.id, { dryRun: false, userId: null, overwrite: true }, { manager });
        // Mark as global default and consolidation chart for the tenant
        await this.coas.setGlobalDefault(created.id, null, { manager });
        await this.coas.setConsolidation(created.id, null, { manager });
      });
    } catch (e) {
      // Swallow provisioning issues to not block tenant creation, but log
      console.warn('[provisioning] Default global CoA provisioning skipped:', (e as Error)?.message);
    }
  }

  private computeTenantUrl(proto: string, host: string, slug: string): string {
    const h = (host || '').toLowerCase();
    if (h.endsWith('lvh.me')) return `${proto}://${slug}.lvh.me`;
    if (h.endsWith('dev.kanap.net')) return `${proto}://${slug}.dev.kanap.net`;
    if (h.endsWith('qa.kanap.net')) return `${proto}://${slug}.qa.kanap.net`;
    return `${proto}://${slug}.kanap.net`;
  }

  private resolveMarketingBaseUrl(req: any): string {
    const configured = process.env.MARKETING_BASE_URL;
    if (configured && configured.trim() !== '') {
      return configured.replace(/\/$/, '');
    }
    const host = (req.headers['x-forwarded-host'] as string) || (req.headers.host as string);
    const proto = this.normalizeForwardedProto((req.headers['x-forwarded-proto'] as string) || req.protocol || 'http');
    const safeHost = this.sanitizeForwardedHost(host);
    if (!safeHost) throw new BadRequestException('Unable to resolve marketing host');
    return `${proto}://${safeHost}`.replace(/\/$/, '');
  }

  private resolveCaptchaToken(body: { captchaToken?: string | null; captcha_token?: string | null }): string | undefined {
    return (body.captchaToken ?? body.captcha_token ?? undefined) || undefined;
  }

  private normalizeForwardedProto(raw: string | undefined): 'http' | 'https' {
    const first = String(raw || '').split(',')[0]?.trim().replace(/:$/, '').toLowerCase();
    return first === 'https' ? 'https' : 'http';
  }

  private sanitizeForwardedHost(raw: string | undefined): string {
    const first = String(raw || '').split(',')[0]?.trim();
    if (!first) return '';
    const withoutScheme = first.replace(/^https?:\/\//i, '');
    const hostAndPort = withoutScheme.split('/')[0] || '';
    if (hostAndPort.startsWith('[')) {
      const end = hostAndPort.indexOf(']');
      return (end >= 0 ? hostAndPort.slice(0, end + 1) : '').toLowerCase();
    }
    const colon = hostAndPort.indexOf(':');
    return (colon >= 0 ? hostAndPort.slice(0, colon) : hostAndPort).toLowerCase();
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

  private buildCompanyName(signup: TrialSignup) {
    if (signup.org_name && signup.org_name.trim().length > 0) return signup.org_name.trim();
    const source = signup.slug ?? 'Tenant';
    return source.charAt(0).toUpperCase() + source.slice(1);
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

  private resolveClientIp(req: any): string | null {
    const cfIp = String(req?.headers?.['cf-connecting-ip'] || '').trim();
    if (cfIp) return cfIp;

    const forwarded = String(req?.headers?.['x-forwarded-for'] || '').trim();
    if (forwarded) {
      const first = forwarded.split(',')[0]?.trim();
      if (first) return first;
    }

    const ip = String(req?.ip || '').trim();
    return ip || null;
  }

  private extractInvoiceId(source: any): string | null {
    if (!source) return null;
    if (typeof source === 'string') return source;
    if (typeof source === 'object' && typeof source.id === 'string') return source.id;
    return null;
  }

  private async finalizeAndSendSupportInvoice(stripe: any, latestInvoice: any): Promise<any | null> {
    const invoiceId = this.extractInvoiceId(latestInvoice);
    if (!invoiceId) return null;

    let invoice: any = latestInvoice;
    if (!invoice || typeof invoice !== 'object') {
      invoice = await stripe.invoices.retrieve(invoiceId);
    }

    if (invoice?.status === 'draft') {
      invoice = await stripe.invoices.finalizeInvoice(invoiceId, { auto_advance: true });
    } else if (!invoice?.status || !invoice?.hosted_invoice_url) {
      invoice = await stripe.invoices.retrieve(invoiceId);
    }

    if (invoice?.collection_method === 'send_invoice' && invoice?.status === 'open') {
      try {
        invoice = await stripe.invoices.sendInvoice(invoiceId);
      } catch (error: any) {
        const msg = typeof error?.message === 'string' ? error.message : 'unknown';
        this.logger.warn(`Unable to send enterprise support invoice ${invoiceId}: ${msg}`);
      }
      if (!invoice?.hosted_invoice_url) {
        try {
          invoice = await stripe.invoices.retrieve(invoiceId);
        } catch (error: any) {
          const msg = typeof error?.message === 'string' ? error.message : 'unknown';
          this.logger.warn(`Unable to refresh enterprise support invoice ${invoiceId}: ${msg}`);
        }
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

    if (messageLower.includes('eu_vat') || messageLower.includes('vat') || code === 'invalid_tax_id') {
      throw new BadRequestException('Invalid VAT number. Please enter a valid EU VAT ID.');
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
