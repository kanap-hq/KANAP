import { BadRequestException, Body, Controller, Get, Logger, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { DataSource } from 'typeorm';
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
      throw new BadRequestException('SSO_NOT_CONFIGURED');
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
    // sync) reuses this redirect URI; it carries no auth code.
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
    this.logger.warn(`Entra ${peek?.mode ?? 'callback'} failed for tenant ${tenant.slug}: ${message}`);
    const base = resolveTenantAppBaseUrl(req, tenant.slug).replace(/\/$/, '');

    if (peek?.mode === 'setup') {
      // Admin-facing: keep the provider detail (e.g. AADSTS codes), truncated.
      const params = new URLSearchParams({ setup: 'error', reason: message.slice(0, 300) });
      res.redirect(`${base}/admin/auth?${params.toString()}`);
      return;
    }
    // End-user facing: a short code only, never provider internals.
    const known = ['ENTRA_EMAIL_UNVERIFIED', 'ENTRA_TENANT_MISMATCH', 'SSO_NOT_CONFIGURED'];
    const code = known.find((k) => message.includes(k)) ?? 'SSO_FAILED';
    res.redirect(`${base}/login?ssoError=${encodeURIComponent(code)}`);
  }

  private async handleConsentCallback(state: string, req: any, res: Response) {
    const tenantId = state.slice('consent:'.length);
    const tenant = tenantId ? await this.tenants.findById(tenantId) : null;
    if (!tenant) {
      throw new BadRequestException('Tenant not found');
    }
    const consentedDirectory = typeof req.query?.tenant === 'string' ? req.query.tenant : null;
    const granted =
      String(req.query?.admin_consent ?? '').toLowerCase() === 'true'
      && (!consentedDirectory || consentedDirectory === tenant.entra_tenant_id);
    const error = typeof req.query?.error_description === 'string'
      ? req.query.error_description
      : typeof req.query?.error === 'string' ? req.query.error : null;

    await withTenant(this.dataSource, tenant.id, (manager) =>
      this.audit.log(
        {
          table: 'tenants',
          recordId: tenant.id,
          action: 'update',
          before: null,
          after: { directory_sync_consent: granted, error, consented_directory: consentedDirectory },
          userId: null,
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

    const baseUrl = resolveTenantAppBaseUrl(req, tenant.slug);
    const normalized = baseUrl.replace(/\/$/, '');
    res.redirect(`${normalized}/admin/auth?consent=${granted ? 'success' : 'error'}`);
  }

  private async handleSetupCallback(
    tenantId: string,
    tenantSlug: string,
    entraTenantId: string,
    claims: any,
    req: any,
    res: Response,
  ) {
    await this.tenants.updateTenant(tenantId, {
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
    });

    await withTenant(this.dataSource, tenantId, (manager) =>
      this.audit.log(
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
      ),
    );

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
    const userId = await withTenant(this.dataSource, tenantId, async (manager) => {
      const repo = manager.getRepository(User);

      let found = await repo.findOne({
        where: {
          external_auth_provider: 'entra' as any,
          external_subject: oid,
        } as any,
        relations: ['role', 'company', 'department'],
      });

      if (!found) {
        found = await repo
          .createQueryBuilder('u')
          .leftJoinAndSelect('u.role', 'role')
          .leftJoinAndSelect('u.company', 'company')
          .leftJoinAndSelect('u.department', 'department')
          .where('LOWER(u.email) = :email', { email })
          .getOne();

        if (found) {
          found.external_auth_provider = 'entra' as any;
          found.external_subject = oid;
          found = await repo.save(found);
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
        found = await repo.save(full);
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
