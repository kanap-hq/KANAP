import { BadRequestException, Body, Controller, Get, HttpCode, Logger, Optional, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { DataSource, EntityManager } from 'typeorm';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionGuard } from './permission.guard';
import { RequireLevel } from './require-level.decorator';
import { EntraAuthService } from './entra-auth.service';
import { TenantsService } from '../tenants/tenants.service';
import { AuthService } from './auth.service';
import { withTenant } from '../common/tenant-runner';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { resolveTenantAppBaseUrl } from '../common/url';
import { isSecureRequest, setRefreshTokenCookie } from './auth-cookie.util';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EntraDirectorySyncService } from './entra-directory-sync.service';
import { readManagerExternalId } from './entra-directory-sync.util';
import { SecurityEventsService } from '../audit/security-events.service';
import { AuthEvent, AuthEventReason } from '../audit/security-events';
import { NeverRejects } from '../common/never-rejects';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { RATE_LIMITS } from '../common/rate-limit';
import { EmailService, isExampleRecipient, maskEmailAddresses } from '../email/email.service';
import { clientAddress } from '../common/client-address';
import { Features } from '../config/features';
import { getPasswordResetExpirationMinutes, getPasswordResetTtl } from './password-reset.util';
import {
  consumeLinkConfirmation,
  hasRecentLinkConfirmation,
  lockAccountForLink,
  lockTenantConnection,
  lockTenantConnectionForChange,
  storeLinkConfirmation,
} from './entra-link-confirmation';

/** The short code of a failed single sign-on, from the error; the provider's message is not kept. */
export function ssoFailureReason(error: unknown): AuthEventReason {
  const message = String((error as { message?: unknown } | null)?.message ?? '');
  if (message.includes('ENTRA_EMAIL_UNVERIFIED')) return 'email_unverified';
  if (message.includes('ENTRA_TENANT_MISMATCH')) return 'tenant_mismatch';
  if (message.includes('SSO_NOT_CONFIGURED')) return 'sso_not_configured';
  if (message.includes('Invalid Entra state')) return 'invalid_state';
  if (message.includes('Invalid Entra login session')) return 'invalid_token';
  return 'sso_failed';
}

/** Statuses of an account that may be linked to a Microsoft account and sign in with it. */
const LINKABLE_STATUSES = new Set(['enabled', 'invited']);

/**
 * Whether a Microsoft sign-in whose account is not linked yet links the existing account that
 * carries its address right away. Only an invited account that has no local password yet does:
 * an administrator prepared it (an invitation to sign in with Microsoft, a password invitation not
 * accepted yet, an import), and it has no other way in. Every other account waits for the
 * confirmation e-mailed to its address. Decided from the account as locked at sign-in.
 */
export function linksWithoutConfirmation(account: { status: string; has_password: boolean }): boolean {
  return account.status === 'invited' && !account.has_password;
}

/** The confirmation e-mail of a link request, sent once the sign-in transaction is committed. */
type LinkConfirmationMail = Parameters<EmailService['sendEntraLinkConfirmationEmail']>[0];

/**
 * A link request recorded with the sign-in. `mail` is null when a confirmation sent a few minutes
 * earlier is still pending: no new link, no new e-mail.
 */
type PendingLinkConfirmation = {
  email: string;
  userId: string;
  tenantId: string;
  token: string | null;
  mail: LinkConfirmationMail | null;
  /** The address and agent of the sign-in, read before it is answered, for the request's event. */
  requestDetails: { ip: unknown; headers: Record<string, unknown> };
};

/** A database error raised by a unique index. */
function isUniqueViolation(error: unknown): boolean {
  const failure = error as { code?: unknown; driverError?: { code?: unknown } } | null;
  return failure?.code === '23505' || failure?.driverError?.code === '23505';
}

/** A query value as text, cut to `max` characters; null when it is not a single string. */
function boundedQueryText(value: unknown, max: number): string | null {
  return typeof value === 'string' ? value.slice(0, max) : null;
}

@Controller('auth/entra')
export class EntraController {
  constructor(
    private readonly entra: EntraAuthService,
    private readonly tenants: TenantsService,
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly directorySync: EntraDirectorySyncService,
    private readonly securityEvents: SecurityEventsService,
    // Absent where no module provides it: an existing account is then not linked (see requestLinkConfirmation).
    @Optional() private readonly email?: EmailService,
  ) {}

  private readonly logger = new Logger(EntraController.name);

  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequireLevel('users', 'admin')
  @Post('setup/start')
  async startSetup(@Req() req: any) {
    if (req?.isPlatformHost) {
      throw new BadRequestException('Entra setup is not available on the platform admin host');
    }
    const tenantMeta = req?.tenant;
    if (!tenantMeta?.id) {
      throw new BadRequestException('TENANT_REQUIRED');
    }

    const { url } = await this.entra.buildAuthorizationUrl({
      mode: 'setup',
      tenantId: tenantMeta.id,
      redirectTo: '/admin/auth',
    });

    return { url };
  }

  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequireLevel('users', 'admin')
  @Get('setup/start')
  async startSetupGet(@Req() req: any, @Res() res: Response) {
    const result = await this.startSetup(req);
    // For direct browser GET, perform a redirect for convenience
    if (result && (result as any).url) {
      res.redirect((result as any).url);
      return;
    }
    res.status(500).json({ message: 'Failed to start Entra setup' });
  }

  @Get('login')
  async startLogin(@Req() req: any, @Res() res: Response) {
    if (req?.isPlatformHost) {
      throw new BadRequestException('Entra login is not available on the platform admin host');
    }
    const tenantMeta = req?.tenant;
    if (!tenantMeta?.id) {
      throw new BadRequestException('TENANT_REQUIRED');
    }

    const tenant = await this.tenants.findById(tenantMeta.id);
    if (!tenant) {
      throw new BadRequestException('Tenant not found');
    }
    if (tenant.sso_provider !== 'entra' || !tenant.entra_tenant_id) {
      // A page loaded before the workspace was disconnected, or a bookmark: back to the sign-in
      // page, which says why.
      const base = resolveTenantAppBaseUrl(req, tenant.slug).replace(/\/$/, '');
      res.redirect(`${base}/login?ssoError=SSO_NOT_CONFIGURED`);
      return;
    }

    const redirectToRaw = req?.query?.redirectTo;
    const redirectTo = typeof redirectToRaw === 'string' && redirectToRaw.trim().length > 0
      ? redirectToRaw
      : '/';

    const { url } = await this.entra.buildAuthorizationUrl({
      mode: 'login',
      tenantId: tenant.id,
      redirectTo,
    });

    res.redirect(url);
  }

  @Get('callback')
  @UseGuards(RateLimitGuard)
  @Throttle({ default: RATE_LIMITS.ssoSignIn })
  async callback(@Req() req: any, @Res() res: Response) {
    // Admin-consent round trip (application permissions for the directory
    // sync) reuses this redirect URI; it carries no auth code, and a state
    // signed for consent after the `consent:` prefix.
    const consentState = typeof req.query?.state === 'string' && req.query.state.startsWith('consent:')
      ? (req.query.state as string)
      : null;
    if (consentState) {
      await this.handleConsentCallback(consentState, req, res);
      return;
    }

    // Filled once the state's signature is checked: the tenant and mode it names are then trusted.
    const verified: { tenantId?: string; mode?: string } = {};
    try {
      await this.completeCallback(req, res, verified);
    } catch (err: any) {
      this.recordCallbackFailure(req, verified, err);
      await this.redirectCallbackError(req, res, err);
    }
  }

  /**
   * A failed sign-in round trip is recorded in the tenant its verified state names or, before
   * the state is checked, in the host's tenant when single sign-on is set up for it (see
   * recordSsoFailure). Setup round trips are not sign-ins.
   */
  private recordCallbackFailure(req: any, verified: { tenantId?: string; mode?: string }, err: unknown) {
    const mode = verified.mode ?? this.entra.peekState(req?.query?.state)?.mode;
    if (mode === 'setup') return;
    void this.recordSsoFailure(req, verified.tenantId, { action: 'sso_login_failed', reason: ssoFailureReason(err) });
  }

  /**
   * Records a failed single sign-on in a tenant the request establishes: the one a verified state
   * or hand-off names (`verifiedTenantId`) or, without one, the host's tenant when single sign-on
   * is set up for it. A request where nothing checks out (no verified state or hand-off, a host
   * without single sign-on, no host tenant) writes nothing. Not awaited by the routes.
   */
  @NeverRejects()
  private async recordSsoFailure(req: any, verifiedTenantId: string | undefined, event: AuthEvent): Promise<void> {
    const tenantId = verifiedTenantId ?? (await this.hostTenantWithSso(req));
    if (!tenantId) return;
    await this.securityEvents.recordAuthEvent(tenantId, event, req);
  }

  /** The host's tenant when Entra single sign-on is set up for it, otherwise null. */
  private async hostTenantWithSso(req: any): Promise<string | null> {
    const hostTenantId = req?.tenant?.id;
    if (typeof hostTenantId !== 'string' || !hostTenantId) return null;
    const tenant = await this.tenants.findById(hostTenantId);
    return tenant?.sso_provider === 'entra' && tenant.entra_tenant_id ? tenant.id : null;
  }

  private async completeCallback(req: any, res: Response, verified: { tenantId?: string; mode?: string } = {}) {
    const result = await this.entra.handleCallback({
      code: req.query?.code,
      state: req.query?.state,
    });

    const { mode, tenantId, redirectTo, claims, accessToken } = result;
    verified.mode = mode;
    if (!tenantId) {
      throw new BadRequestException('Missing tenant context');
    }

    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw new BadRequestException('Tenant not found');
    }
    verified.tenantId = tenant.id;

    const tid = (claims as any)?.tid as string | undefined;
    if (!tid) {
      throw new BadRequestException('Entra tenant id (tid) is missing');
    }

    if (mode === 'setup') {
      await this.handleSetupCallback(tenantId, tenant.slug, tid, claims, req, res);
      return;
    }

    if (mode === 'login') {
      if (tenant.sso_provider !== 'entra' || !tenant.entra_tenant_id) {
        throw new BadRequestException('SSO_NOT_CONFIGURED');
      }
      if (tenant.entra_tenant_id !== tid) {
        throw new BadRequestException('ENTRA_TENANT_MISMATCH');
      }

      let graphProfile: any = null;
      const enrichEnabled = String(process.env.ENTRA_ENRICH_PROFILE || 'true').toLowerCase() !== 'false';
      if (enrichEnabled && accessToken) {
        try {
          graphProfile = await this.entra.fetchGraphProfile(accessToken);
        } catch (err: any) {
          this.logger.warn(`Graph profile fetch failed: ${err?.message || err}`);
        }
      }

      await this.handleLoginCallback(tenantId, tenant.slug, redirectTo, claims, graphProfile, req, res);
      return;
    }

    throw new BadRequestException('Unsupported Entra callback mode');
  }

  @Post('session')
  @UseGuards(RateLimitGuard)
  @Throttle({ default: RATE_LIMITS.ssoSignIn })
  async completeLoginSession(@Body() body: any, @Req() req: any, @Res({ passthrough: true }) res: Response) {
    // The account of a verified hand-off for this tenant, once known.
    const attempt: { userId?: string } = {};
    let session: Awaited<ReturnType<EntraController['issueLoginSession']>>;
    try {
      session = await this.issueLoginSession(body?.handoff, req, res, attempt);
    } catch (err) {
      // A verified hand-off for this host names its tenant; otherwise the host must have single sign-on.
      void this.recordSsoFailure(req, attempt.userId ? req?.tenant?.id : undefined, {
        action: 'sso_login_failed',
        reason: ssoFailureReason(err),
        userId: attempt.userId ?? null,
      });
      throw err;
    }
    void this.securityEvents.recordAuthEvent(req?.tenant?.id, { action: 'sso_login', userId: attempt.userId ?? null }, req);
    return {
      access_token: session.tokens.access_token,
      expires_in: session.tokens.expires_in,
      refresh_expires_in: session.tokens.refresh_expires_in,
      redirectTo: session.redirectPath,
    };
  }

  private async issueLoginSession(
    handoffToken: string | undefined,
    req: any,
    res: Response,
    attempt: { userId?: string } = {},
  ): Promise<{
    tokens: { access_token: string; refresh_token: string; expires_in: number; refresh_expires_in: number };
    redirectPath: string;
  }> {
    if (req?.isPlatformHost) {
      throw new BadRequestException('Entra login is not available on the platform admin host');
    }
    const tenantMeta = req?.tenant;
    if (!tenantMeta?.id) {
      throw new BadRequestException('TENANT_REQUIRED');
    }

    if (!handoffToken || typeof handoffToken !== 'string') {
      throw new BadRequestException('Missing Entra login session');
    }

    const handoff = this.entra.verifyLoginHandoff(handoffToken);
    if (handoff.tenantId !== tenantMeta.id) {
      throw new BadRequestException('ENTRA_TENANT_MISMATCH');
    }
    attempt.userId = handoff.userId;

    const tenant = await this.tenants.findById(handoff.tenantId);
    if (!tenant) {
      throw new BadRequestException('Tenant not found');
    }
    if (tenant.sso_provider !== 'entra' || !tenant.entra_tenant_id) {
      throw new BadRequestException('SSO_NOT_CONFIGURED');
    }

    const tokens = await withTenant(this.dataSource, handoff.tenantId, async (manager) => {
      const user = await manager.getRepository(User).findOne({
        where: { id: handoff.userId } as any,
        relations: ['role'],
      });
      if (!user || user.status !== 'enabled' || !user.role) {
        throw new BadRequestException('Entra user is not allowed to sign in');
      }
      await this.users.touchLastLogin(user.id, { manager });
      return this.auth.signTokens(
        { id: user.id, email: user.email, role: user.role, tenant_id: handoff.tenantId },
        manager,
      );
    });

    setRefreshTokenCookie(res, tokens.refresh_token, tokens.refresh_expires_in, isSecureRequest(req));
    const redirectPath = handoff.redirectTo && typeof handoff.redirectTo === 'string' && handoff.redirectTo.startsWith('/')
      ? handoff.redirectTo
      : '/';
    return { tokens, redirectPath };
  }

  /**
   * A failed setup/login callback must land back in the app with a readable
   * message, not as a JSON error page. Falls back to the default error
   * response only when no tenant can be derived for the redirect.
   */
  private async redirectCallbackError(req: any, res: Response, err: any) {
    const peek = this.entra.peekState(req.query?.state);
    const tenant = peek?.tenantId ? await this.tenants.findById(peek.tenantId).catch(() => null) : null;
    if (!tenant) throw err;

    const message = String(err?.message || 'ENTRA_ERROR');
    // Messages may quote an address (a transport, the directory): logged without it.
    this.logger.warn(`Entra ${peek?.mode ?? 'callback'} failed for tenant ${tenant.slug}: ${maskEmailAddresses(message)}`);
    const base = resolveTenantAppBaseUrl(req, tenant.slug).replace(/\/$/, '');

    if (peek?.mode === 'setup') {
      // Admin-facing: keep the provider detail (e.g. AADSTS codes), truncated.
      const params = new URLSearchParams({ setup: 'error', reason: message.slice(0, 300) });
      res.redirect(`${base}/admin/auth?${params.toString()}`);
      return;
    }
    // End-user facing: a short code only, never provider internals.
    const known = ['ENTRA_EMAIL_UNVERIFIED', 'ENTRA_TENANT_MISMATCH', 'SSO_NOT_CONFIGURED', 'ENTRA_ACCOUNT_LINKED', 'ENTRA_LINK_NEEDS_EMAIL'];
    const code = known.find((k) => message.includes(k)) ?? 'SSO_FAILED';
    res.redirect(`${base}/login?ssoError=${encodeURIComponent(code)}`);
  }

  /**
   * Return from the Microsoft admin-consent screen. Nothing is read or written unless the state
   * was signed by this application for consent; the workspace is the one the state names. Past
   * its lifetime, such a state writes and starts nothing: the administrator lands back on the
   * settings, where the consent can be opened again. The consent counts as granted only when the
   * directory that answered is the one the workspace is connected to.
   */
  private async handleConsentCallback(state: string, req: any, res: Response) {
    const consent = this.entra.verifyConsentState(state.slice('consent:'.length));
    const tenant = await this.tenants.findById(consent.tenantId);
    if (!tenant) {
      throw new BadRequestException('Tenant not found');
    }
    const settingsUrl = `${resolveTenantAppBaseUrl(req, tenant.slug).replace(/\/$/, '')}/admin/auth`;
    if (consent.expired) {
      // No outcome to report: Microsoft may have recorded the consent, the settings offer it again.
      res.redirect(settingsUrl);
      return;
    }
    const consentedDirectory = boundedQueryText(req.query?.tenant, 100);
    const granted =
      String(req.query?.admin_consent ?? '').toLowerCase() === 'true'
      && !!tenant.entra_tenant_id
      && consentedDirectory === tenant.entra_tenant_id;
    // The provider's text, kept for the administrators who read the audit log.
    const error = boundedQueryText(req.query?.error_description, 300) ?? boundedQueryText(req.query?.error, 300);

    await withTenant(this.dataSource, tenant.id, (manager) =>
      this.audit.log(
        {
          table: 'tenants',
          recordId: tenant.id,
          action: 'update',
          before: null,
          after: { directory_sync_consent: granted, error, consented_directory: consentedDirectory },
          // The administrator who opened the consent from the settings.
          userId: consent.userId,
          source: 'system',
          sourceRef: 'entra-admin-consent',
        },
        { manager },
      ),
    );

    if (granted) {
      // A token cached before the grant lacks the new permission.
      if (tenant.entra_tenant_id) this.entra.invalidateAppToken(tenant.entra_tenant_id);
      // First sync right away so the settings page reflects the grant.
      this.directorySync.syncTenant(tenant.id).catch((err) =>
        this.logger.warn(`Directory sync after consent failed: ${err?.message || err}`),
      );
    }

    res.redirect(`${settingsUrl}?consent=${granted ? 'success' : 'error'}`);
  }

  /**
   * A Microsoft sign-in found an existing account by its address: a link that confirms the link is
   * stored and e-mailed to that address. A confirmation sent less than a few minutes ago stands:
   * no new link, no new e-mail. Without an e-mail service, an existing account is not linked this
   * way.
   */
  private async requestLinkConfirmation(
    manager: EntityManager,
    tenantId: string,
    account: User,
    claims: any,
    req: any,
    tenantSlug: string,
  ): Promise<PendingLinkConfirmation> {
    const oid = String(claims?.oid ?? '');
    const tid = String(claims?.tid ?? '');
    if (!LINKABLE_STATUSES.has(account.status)) {
      throw new BadRequestException('Entra user is not allowed to sign in');
    }
    if (!Features.EMAIL_ENABLED || !this.email) {
      throw new BadRequestException('ENTRA_LINK_NEEDS_EMAIL');
    }
    if (!tid) {
      throw new BadRequestException('Entra tenant id (tid) is missing');
    }
    // Requests and confirmations of one account run one after the other.
    const locked = await lockAccountForLink(manager, tenantId, account.id);
    if (!locked || locked.external_auth_provider) {
      throw new BadRequestException('ENTRA_ACCOUNT_LINKED');
    }
    const pending = {
      email: account.email,
      userId: account.id,
      tenantId,
      requestDetails: { ip: clientAddress(req), headers: { 'user-agent': req?.headers?.['user-agent'] } },
    };
    if (await hasRecentLinkConfirmation(manager, tenantId, account.id)) {
      return { ...pending, token: null, mail: null };
    }
    const { token, expiresAt } = this.entra.signLinkConfirmation(
      {
        tenantId,
        userId: account.id,
        email: account.email.trim().toLowerCase(),
        oid,
        tid,
        name: claims?.name,
        username: claims?.preferred_username,
      },
      getPasswordResetTtl(),
    );
    await storeLinkConfirmation(manager, { tenantId, userId: account.id, token, expiresAt });
    const shown = this.entra.verifyLinkConfirmation(token);
    const base = resolveTenantAppBaseUrl(req, tenantSlug).replace(/\/$/, '');
    return {
      ...pending,
      token,
      mail: {
        to: account.email,
        confirmUrl: `${base}/login/link-microsoft#${new URLSearchParams({ token }).toString()}`,
        expiresInMinutes: getPasswordResetExpirationMinutes(),
        microsoftAccount: { name: shown.name ?? null, username: shown.username ?? null },
        requestedAt: new Date(),
        firstName: account.first_name ?? null,
        tenantId,
        locale: account.locale ?? undefined,
      },
    };
  }

  /**
   * Sends a link confirmation once the sign-in has answered, then records the
   * `sso_link_requested` event, as a password reset request records its own: the account, the
   * address and agent, and the reason `email_not_sent` when the e-mail could not be sent. Never
   * awaited by the route, never handed the request's entity manager, and never rejects: a failed
   * send is logged without the link, its token or an address. A request held off by a recent
   * confirmation makes no link and records nothing.
   */
  @NeverRejects()
  private async deliverLinkConfirmation(link: PendingLinkConfirmation): Promise<void> {
    if (!link.mail || !link.token || !this.email) return;
    // EmailService never writes to a reserved `.example` address: nothing goes out.
    let reason: AuthEventReason | null = isExampleRecipient(link.mail.to) ? 'email_not_sent' : null;
    try {
      await this.email.sendEntraLinkConfirmationEmail(link.mail);
    } catch (error) {
      reason = 'email_not_sent';
      let message = String((error as { message?: unknown } | null)?.message ?? error);
      message = message.split(link.mail.confirmUrl).join('[link]').split(link.token).join('[token]');
      this.logger.error(
        `Microsoft link confirmation e-mail not sent (tenant ${link.tenantId}, user ${link.userId}): ${maskEmailAddresses(message)}`,
      );
    }
    await this.securityEvents.recordAuthEvent(
      link.tenantId,
      { action: 'sso_link_requested', userId: link.userId, reason },
      link.requestDetails,
    );
  }

  /**
   * The owner of an account confirms, from the e-mailed link, its link to the Microsoft account
   * that signed in. The link works once, until it expires, and only while it is the account's
   * latest; the account must still carry the address it was sent to and have no link, and the
   * Microsoft account must not be linked to another account. The local password stays.
   */
  @Post('link')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @Throttle({ default: RATE_LIMITS.ssoSignIn })
  async confirmLink(@Body() body: any, @Req() req: any) {
    if (req?.isPlatformHost) {
      throw new BadRequestException('Entra login is not available on the platform admin host');
    }
    const tenantId = req?.tenant?.id;
    if (!tenantId) {
      throw new BadRequestException('TENANT_REQUIRED');
    }
    const link = this.entra.verifyLinkConfirmation(body?.token);
    if (link.tenantId !== tenantId) {
      throw new BadRequestException('ENTRA_LINK_INVALID');
    }
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant || tenant.sso_provider !== 'entra' || tenant.entra_tenant_id !== link.tid) {
      throw new BadRequestException('ENTRA_LINK_INVALID');
    }

    await withTenant(this.dataSource, tenantId, async (manager) => {
      // The workspace is still connected to the directory that signed the link, until the end of
      // the transaction (a disconnect waits for it).
      const connection = await lockTenantConnection(manager, tenantId);
      if (connection?.sso_provider !== 'entra' || connection.entra_tenant_id !== link.tid) {
        throw new BadRequestException('ENTRA_LINK_INVALID');
      }
      // Requests and confirmations of one account run one after the other.
      const account = await lockAccountForLink(manager, tenantId, link.userId);
      const userId = await consumeLinkConfirmation(manager, tenantId, body.token);
      if (!account || !userId || userId !== link.userId) {
        throw new BadRequestException('ENTRA_LINK_INVALID');
      }
      if (String(account.email).trim().toLowerCase() !== link.email || !LINKABLE_STATUSES.has(account.status)) {
        throw new BadRequestException('ENTRA_LINK_INVALID');
      }
      const [taken] = await manager.query(
        `SELECT 1 FROM users WHERE tenant_id = $1 AND external_auth_provider = 'entra' AND external_subject = $2 LIMIT 1`,
        [tenantId, link.oid],
      );
      if (account.external_auth_provider || taken) {
        throw new BadRequestException('ENTRA_ACCOUNT_LINKED');
      }
      // The two link columns only: the password and the rest of the account stay as they are. The
      // same Microsoft account confirmed for another account at the same moment hits the unique
      // index: the account stays unlinked.
      let changed: Array<{ count: number }>;
      try {
        changed = await manager.query(
          `WITH changed AS (
             UPDATE users SET external_auth_provider = 'entra', external_subject = $3, updated_at = now()
             WHERE tenant_id = $1 AND id = $2 AND external_auth_provider IS NULL
             RETURNING 1
           )
           SELECT count(*)::int AS count FROM changed`,
          [tenantId, userId, link.oid],
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw new BadRequestException('ENTRA_ACCOUNT_LINKED');
        throw error;
      }
      if (changed[0]?.count !== 1) {
        throw new BadRequestException('ENTRA_ACCOUNT_LINKED');
      }
      await this.audit.log(
        {
          table: 'users',
          recordId: userId,
          action: 'update',
          before: { external_auth_provider: null, external_subject: null },
          after: { external_auth_provider: 'entra', external_subject: link.oid, email: account.email },
          userId,
          source: 'system',
          sourceRef: 'entra-link-confirmed',
        },
        { manager },
      );
    });
    return { linked: true };
  }

  private async handleSetupCallback(
    tenantId: string,
    tenantSlug: string,
    entraTenantId: string,
    claims: any,
    req: any,
    res: Response,
  ) {
    await withTenant(this.dataSource, tenantId, async (manager) => {
      // A connection changes the directory sign-ins check: it waits for the sign-ins in progress.
      await lockTenantConnectionForChange(manager, tenantId);
      await this.tenants.updateTenant(
        tenantId,
        {
          sso_provider: 'entra' as any,
          entra_tenant_id: entraTenantId,
          sso_enabled: true as any,
          entra_metadata: {
            ...(claims?.name ? { display_name: claims.name } : {}),
            ...(claims?.email || claims?.preferred_username
              ? { primary_domain: String(claims.email || claims.preferred_username).split('@')[1] || null }
              : {}),
            connected_at: new Date().toISOString(),
          } as any,
        },
        { manager },
      );
      await this.audit.log(
        {
          table: 'tenants',
          recordId: tenantId,
          action: 'update',
          before: null,
          after: { sso_provider: 'entra', entra_tenant_id: entraTenantId, sso_enabled: true },
          userId: null,
          source: 'system',
          sourceRef: 'entra-setup',
        },
        { manager },
      );
    });

    const baseUrl = resolveTenantAppBaseUrl(req, tenantSlug);
    const normalized = baseUrl.replace(/\/$/, '');
    res.redirect(`${normalized}/admin/auth?setup=success`);
  }

  private async handleLoginCallback(
    tenantId: string,
    tenantSlug: string,
    redirectTo: string | undefined,
    claims: any,
    graphProfile: any,
    req: any,
    res: Response,
  ) {
    const oid = (claims as any)?.oid as string | undefined;
    const emailRaw = (claims as any)?.email || (claims as any)?.preferred_username;
    const email = typeof emailRaw === 'string' ? emailRaw.trim().toLowerCase() : '';
    if (!oid) {
      throw new BadRequestException('Entra object id (oid) is missing');
    }
    if (!email) {
      throw new BadRequestException('Entra user email is missing');
    }
    // If the token carries an explicit "email not verified" signal, refuse the login:
    // the email is used below to link existing KANAP accounts, so an unverified
    // address must never be trusted for account matching.
    const emailVerified = (claims as any)?.email_verified ?? (claims as any)?.xms_edov;
    if (emailVerified === false || emailVerified === 'false') {
      throw new BadRequestException('ENTRA_EMAIL_UNVERIFIED');
    }

    const givenName = (graphProfile?.givenName as string | undefined) || (claims as any)?.given_name;
    const familyName = (graphProfile?.surname as string | undefined) || (claims as any)?.family_name;
    let firstName = givenName || '';
    let lastName = familyName || '';
    if (!firstName && !lastName && typeof (graphProfile as any)?.displayName === 'string') {
      const parts = String((graphProfile as any).displayName).trim().split(/\s+/);
      firstName = parts[0] ?? '';
      lastName = parts.slice(1).join(' ') || '';
    }
    if (!firstName && !lastName && typeof (claims as any)?.name === 'string') {
      const parts = String((claims as any).name).trim().split(/\s+/);
      firstName = parts[0] ?? '';
      lastName = parts.slice(1).join(' ') || '';
    }

    const jobTitle = (graphProfile?.jobTitle as string | undefined) || null;
    const businessPhone = Array.isArray(graphProfile?.businessPhones) ? graphProfile.businessPhones[0] || null : null;
    const mobilePhone = (graphProfile?.mobilePhone as string | undefined) || null;

    let jitProvisioned = false;
    // Set when the sign-in found an existing account that waits for its owner's confirmation.
    const pending: { link?: PendingLinkConfirmation } = {};
    const userId = await withTenant(this.dataSource, tenantId, async (manager) => {
      // The workspace is still connected to this directory, until the end of the transaction: a
      // disconnect waits for this sign-in, and one made meanwhile is read here.
      const connection = await lockTenantConnection(manager, tenantId);
      if (connection?.sso_provider !== 'entra' || connection.entra_tenant_id !== (claims as any)?.tid) {
        throw new BadRequestException('SSO_NOT_CONFIGURED');
      }
      const repo = manager.getRepository(User);

      let found = await repo.findOne({
        where: {
          external_auth_provider: 'entra' as any,
          external_subject: oid,
        } as any,
        relations: ['role', 'company', 'department'],
      });
      if (found) {
        // Locked, then read again, as the directory sync does: an administrator may have unlinked
        // the account meanwhile (Unlink from Microsoft, a disconnect, the sync keeping the last
        // Administrator). An account no longer linked to this Microsoft account is not linked back
        // here: it follows the rule of an existing account below.
        const locked = await lockAccountForLink(manager, tenantId, found.id);
        found = locked && locked.external_auth_provider === 'entra'
          ? await repo.findOne({
            where: { id: found.id, external_auth_provider: 'entra' as any, external_subject: oid } as any,
            relations: ['role', 'company', 'department'],
          })
          : null;
      }

      if (!found) {
        const local = await repo
          .createQueryBuilder('u')
          .leftJoinAndSelect('u.role', 'role')
          .leftJoinAndSelect('u.company', 'company')
          .leftJoinAndSelect('u.department', 'department')
          .where('LOWER(u.email) = :email', { email })
          .getOne();

        // An account linked to another Microsoft account keeps that link: only an administrator removes it.
        if (local?.external_auth_provider) {
          throw new BadRequestException('ENTRA_ACCOUNT_LINKED');
        }
        // Sign-ins and confirmations of one account run one after the other: the account is read
        // again once locked, so two sign-ins at once never both link it.
        const locked = local ? await lockAccountForLink(manager, tenantId, local.id) : null;
        if (local && (!locked || locked.external_auth_provider)) {
          throw new BadRequestException('ENTRA_ACCOUNT_LINKED');
        }
        if (local && locked && !linksWithoutConfirmation(locked)) {
          // An existing account is linked only once its owner confirms from the link e-mailed to it.
          pending.link = await this.requestLinkConfirmation(manager, tenantId, local, claims, req, tenantSlug);
          return null;
        }

        found = local;
        if (found) {
          // Saved once, below, with the profile. The account is read without its password and
          // two-step secret: after a save TypeORM holds them as null, and a second save of the
          // same object would write that null.
          found.external_auth_provider = 'entra' as any;
          found.external_subject = oid;
          await this.audit.log(
            {
              table: 'users',
              recordId: found.id,
              action: 'update',
              before: { external_auth_provider: null, external_subject: null },
              after: { external_auth_provider: 'entra', external_subject: oid, email: found.email },
              userId: found.id,
              source: 'system',
              sourceRef: 'entra-auto-link',
            },
            { manager },
          );
        }
      }

      if (!found) {
        const created = await this.users.createUser(
          {
            email,
            first_name: firstName || null,
            last_name: lastName || null,
            job_title: jobTitle || null,
            business_phone: businessPhone || null,
            mobile_phone: mobilePhone || null,
            tenant_id: tenantId,
            role_name: 'Contact',
            password: null,
            status: 'enabled',
          },
          { manager },
        );
        const full = await this.users.findById(created.id, { manager });
        if (!full) {
          throw new BadRequestException('Failed to create user for Entra identity');
        }
        full.external_auth_provider = 'entra' as any;
        full.external_subject = oid;
        // Saved once, below, with the profile.
        found = full;
        await this.audit.log(
          {
            table: 'users',
            recordId: found.id,
            action: 'update',
            before: null,
            after: { external_auth_provider: 'entra', external_subject: oid, email: found.email },
            userId: found.id,
            source: 'system',
            sourceRef: 'entra-jit-provisioning',
          },
          { manager },
        );
        jitProvisioned = true;
      }

      // An invitation ends at the first sign-in: with Microsoft as with the password link, the
      // invited account is enabled (within the subscription's seats). A disabled one stays refused.
      if (found.status === 'invited') {
        await this.users.enableUser(found.id, null, { manager });
        found.status = 'enabled' as any;
      }

      // Directory-owned fields: same merge rules as the scheduled sync
      // (non-empty Entra value wins, empty never clears, locale only if unset).
      await this.directorySync.applyDirectoryProfile(
        found,
        { ...(graphProfile ?? {}), givenName: firstName || null, surname: lastName || null },
        manager,
      );
      found = await repo.save(found);

      // Reporting line, when this person is a contributor and their directory
      // manager already has a KANAP account. Nothing to do otherwise.
      await this.directorySync.syncDirectoryManagers(
        tenantId,
        [{ userId: found.id, managerExternalId: readManagerExternalId(graphProfile) }],
        manager,
      );

      return found.id;
    });

    if (pending.link || !userId) {
      // The confirmation e-mail goes out once the link request is committed, without holding the answer.
      const link = pending.link as PendingLinkConfirmation;
      void this.deliverLinkConfirmation(link);
      const base = resolveTenantAppBaseUrl(req, tenantSlug).replace(/\/$/, '');
      res.redirect(`${base}/login?ssoNotice=ENTRA_LINK_SENT#${new URLSearchParams({ to: link.email }).toString()}`);
      return;
    }

    if (jitProvisioned) {
      // Fire-and-forget: the login redirect must not wait on admin emails.
      const displayName = [firstName, lastName].filter(Boolean).join(' ').trim() || email;
      this.notifications
        .notifySsoUserProvisioned({ userName: displayName, userEmail: email, tenantId })
        .catch((err) => this.logger.warn(`SSO provisioning notification failed: ${err?.message || err}`));
    }

    const baseUrl = resolveTenantAppBaseUrl(req, tenantSlug);
    const normalized = baseUrl.replace(/\/$/, '');
    const redirectPath = redirectTo && typeof redirectTo === 'string' && redirectTo.startsWith('/') ? redirectTo : '/';
    const handoff = this.entra.signLoginHandoff({ tenantId, userId, redirectTo: redirectPath });
    const fragment = new URLSearchParams({ handoff });
    const target = `${normalized}/login/callback#${fragment.toString()}`;
    res.redirect(target);
  }
}
