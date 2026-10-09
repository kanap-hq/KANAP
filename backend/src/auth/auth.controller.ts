import { Body, Controller, Post, BadRequestException, Get, Req, Res, UnauthorizedException, UseGuards, Logger } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { PermissionsService, RESOURCES } from '../permissions/permissions.service';
import { BillingService } from '../billing/billing.service';
import * as jwt from 'jsonwebtoken';
import { EmailService } from '../email/email.service';
import { resolveAppBaseUrl } from '../common/url';
import { assertRequestOriginAllowed } from '../common/cors-policy';
import { Features } from '../config/features';
import { throwFeatureDisabled } from '../common/feature-gates';
import { isPlatformAdmin } from './platform-admin.util';
import { FxIngestionService } from '../currency/fx-ingestion.service';
import { DataSource, EntityManager } from 'typeorm';
import { withTenant } from '../common/tenant-runner';
import { PROVISIONING_PURPOSE } from './access-token.util';
import { getProvisioningSecret } from './token-secret.util';
import { PROVISIONING_TOKEN_ALGORITHMS } from './jwt-algorithms';
import { TenantsService } from '../tenants/tenants.service';
import { UserRole } from '../users/user-role.entity';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { RATE_LIMITS } from '../common/rate-limit';
import { Response } from 'express';
import {
  REFRESH_TOKEN_COOKIE_NAME,
  clearRefreshTokenCookie,
  isSecureRequest,
  parseCookieValue,
  setRefreshTokenCookie,
} from './auth-cookie.util';

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

class PasswordResetRequestDto {
  @IsEmail()
  email!: string;
}

class CompletePasswordResetDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

class RefreshTokenDto {
  @IsOptional()
  @IsString()
  refresh_token?: string;
}

class LogoutDto {
  @IsOptional()
  @IsString()
  refresh_token?: string;
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_expires_in?: number;
};

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly perms: PermissionsService,
    private readonly billing: BillingService,
    private readonly emails: EmailService,
    private readonly fxIngestion: FxIngestionService,
    private readonly dataSource: DataSource,
    private readonly tenants: TenantsService,
  ) {}

  private async runInRequestTenant<T>(
    req: any,
    fn: (manager?: EntityManager) => Promise<T>,
  ): Promise<T> {
    const tenantId = req?.tenant?.id;
    if (tenantId) {
      return withTenant(this.dataSource, tenantId, fn);
    }

    const runner = req?.queryRunner;
    const manager = runner && !runner.isReleased ? runner.manager : undefined;
    return fn(manager);
  }

  @Post('login')
  @UseGuards(RateLimitGuard)
  @Throttle({ default: RATE_LIMITS.authLogin })
  async login(@Body() body: LoginDto, @Req() req: any, @Res({ passthrough: true }) res: Response) {
    if (!body?.email || !body?.password) throw new BadRequestException({ code: 'MISSING_CREDENTIALS', message: 'email and password are required' });
    const tokens = await this.runInRequestTenant(req, async (manager) => {
      const user = await this.auth.validateUser(body.email, body.password, manager);
      await this.users.touchLastLogin(user.id, { manager });
      void this.fxIngestion.maybeRefreshOnLogin((user as any)?.tenant_id);
      return this.auth.signTokens(
        { id: user.id, email: user.email, role: user.role, tenant_id: (user as any)?.tenant_id },
        manager,
      );
    });
    setRefreshTokenCookie(res, tokens.refresh_token, tokens.refresh_expires_in, isSecureRequest(req));
    return this.toTokenResponse(tokens);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Req() req: any) {
    const sub = req?.user?.sub as string | undefined;
    if (!sub) throw new BadRequestException({ code: 'INVALID_TOKEN', message: 'Invalid token' });
    const manager: EntityManager | undefined = req?.queryRunner?.manager;
    const user = await this.users.findById(sub, { manager });
    if (!user) throw new BadRequestException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    if (user.status !== 'enabled') {
      // A still-valid access token must not keep serving a disabled account.
      throw new UnauthorizedException({ code: 'USER_DISABLED', message: 'User disabled' });
    }
    const tenantId = req?.tenant?.id;
    const tenant = tenantId ? await this.tenants.findById(tenantId) : null;
    const tenantAuth = tenant
      ? { sso_provider: tenant.sso_provider ?? 'none', sso_enabled: !!tenant.sso_enabled }
      : { sso_provider: 'none', sso_enabled: false };

    // Load all roles for this user (multi-role support)
    const userRolesRepo = (manager ?? this.dataSource.manager).getRepository(UserRole);
    const userRoles = await userRolesRepo.find({
      where: { user_id: user.id },
      relations: ['role'],
    });

    // Get all role IDs (include legacy role_id for backwards compatibility)
    const roleIds = new Set<string>();
    if (user.role_id) roleIds.add(user.role_id);
    for (const ur of userRoles) roleIds.add(ur.role_id);
    const roleIdArray = Array.from(roleIds);

    // Check if user has Administrator role (any of their roles)
    const roleNames = userRoles.map(ur => ur.role?.role_name?.toLowerCase() ?? '');
    if (user.role?.role_name) roleNames.push(user.role.role_name.toLowerCase());
    const isGlobalAdmin = roleNames.includes('administrator');

    // Compute effective permissions using union logic across all roles
    const permissions: Record<string, 'reader' | 'contributor' | 'member' | 'admin'> = {};
    if (isGlobalAdmin) {
      for (const r of RESOURCES) permissions[r] = 'admin';
    } else {
      const map = await this.perms.listForRoles(roleIdArray, { manager });
      for (const r of RESOURCES) {
        const lv = map.get(r);
        if (lv) permissions[r] = lv;
      }
    }
    const isBillingAdmin = isGlobalAdmin || permissions['billing'] === 'admin';
    const isPlatform = req?.isPlatformHost === true
      && isPlatformAdmin({ email: user.email, role: { role_name: user.role?.role_name ?? null } });

    const subscription = await this.billing.getSubscriptionSummary({ manager });

    // Build roles array for profile (all assigned roles)
    const roles = userRoles
      .filter(ur => ur.role)
      .map(ur => ({
        id: ur.role_id,
        name: ur.role!.role_name,
      }));
    // Include legacy role if not already in list
    if (user.role && !roles.some(r => r.id === user.role_id)) {
      roles.unshift({ id: user.role_id, name: user.role.role_name });
    }

    const profile = {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      job_title: user.job_title,
      business_phone: user.business_phone,
      mobile_phone: user.mobile_phone,
      locale: user.locale,
      status: user.status,
      role: user.role?.role_name ?? null, // Primary role name (backwards compat)
      roles, // All assigned roles
      external_auth_provider: user.external_auth_provider ?? null,
    };
    return {
      profile,
      claims: {
        isGlobalAdmin,
        isBillingAdmin,
        isPlatformAdmin: isPlatform,
        permissions,
      },
      subscription,
      tenantAuth,
    };
  }

  @Post('exchange-provisioning-token')
  @UseGuards(RateLimitGuard)
  @Throttle({ default: RATE_LIMITS.authProvisioningExchange })
  async exchangeProvisioningToken(@Body() body: { token?: string }) {
    const t = body?.token;
    if (!t) throw new BadRequestException({ code: 'TOKEN_REQUIRED', message: 'token is required' });
    // Dedicated `PROVISIONING_TOKEN_SECRET` when configured, otherwise `JWT_SECRET` — the issuer
    // lives outside this repository and cannot compute a derived key. Sharing the key is safe
    // because `JwtAuthGuard` refuses the `provision` marker; what made it dangerous was the missing
    // purpose control (constat n°2).
    const secret = getProvisioningSecret();
    let payload: any;
    try {
      payload = jwt.verify(t, secret, { algorithms: [...PROVISIONING_TOKEN_ALGORITHMS] });
    } catch {
      throw new BadRequestException({ code: 'TOKEN_EXPIRED', message: 'invalid or expired token' });
    }
    if (!payload || payload.purpose !== PROVISIONING_PURPOSE || !payload.tenant_id || !payload.email) {
      throw new BadRequestException('invalid token payload');
    }
    const tenantId = payload.tenant_id as string;
    const user = await withTenant(this.dataSource, tenantId, async (manager) => {
      return this.users.findByEmail(payload.email, { manager });
    });
    if (!user) throw new BadRequestException('user not found');
    return this.auth.signToken({ id: user.id, email: user.email, role: user.role, tenant_id: tenantId });
  }

  @Post('password-reset/request')
  @UseGuards(RateLimitGuard)
  @Throttle({ default: RATE_LIMITS.authPasswordResetRequest })
  async requestPasswordReset(@Body() body: PasswordResetRequestDto, @Req() req: any) {
    if (!Features.EMAIL_ENABLED) throwFeatureDisabled('email');
    // The link base comes from the configuration and is checked before the account lookup:
    // without it every address gets the same answer.
    const baseUrl = resolveAppBaseUrl(req);
    const email = body.email.trim().toLowerCase();
    const user = await this.runInRequestTenant(req, (manager) => this.users.findByEmail(email, { manager }));
    if (!user) return { ok: true };
    // Externally managed accounts (Entra) have no local password. Silent ok:
    // this endpoint is unauthenticated and must not leak the account type.
    if (user.external_auth_provider) return { ok: true };

    const token = await this.runInRequestTenant(req, (manager) => this.auth.createPasswordResetToken(user, manager));
    const resetUrl = `${baseUrl.replace(/\/$/, '')}/reset-password#token=${encodeURIComponent(token)}`;
    await this.emails.sendPasswordResetEmail({
      to: email,
      resetUrl,
      expiresInMinutes: this.auth.getPasswordResetExpirationMinutes(),
      // `getEmailStrings` / `resolveEmailLocale` treat null and undefined identically.
      locale: user.locale ?? undefined,
    });
    return { ok: true };
  }

  @Post('password-reset/complete')
  @UseGuards(RateLimitGuard)
  @Throttle({ default: RATE_LIMITS.authPasswordResetComplete })
  async completePasswordReset(@Body() body: CompletePasswordResetDto, @Req() req: any) {
    await this.runInRequestTenant(req, (manager) => this.auth.resetPasswordWithToken(body.token, body.password, { manager }));
    return { ok: true };
  }

  @Post('refresh')
  @UseGuards(RateLimitGuard)
  @Throttle({ default: RATE_LIMITS.authRefresh })
  async refreshToken(@Body() body: RefreshTokenDto, @Req() req: any, @Res({ passthrough: true }) res: Response) {
    // Same origin rule as CORS, before the cookie is read (common/cors-policy.ts).
    assertRequestOriginAllowed(req);
    const refreshToken = this.resolveRefreshToken(req, body);
    if (!refreshToken) throw new BadRequestException('refresh_token is required');
    const refreshed = await this.runInRequestTenant(req, (manager) => this.auth.refreshAccessToken(refreshToken, req?.tenant?.id, manager));
    setRefreshTokenCookie(res, refreshToken, refreshed.refresh_expires_in, isSecureRequest(req));
    return refreshed;
  }

  @Post('logout')
  async logout(@Body() body: LogoutDto, @Req() req: any, @Res({ passthrough: true }) res: Response) {
    // Same origin rule as CORS, before the cookie is cleared or the token revoked.
    assertRequestOriginAllowed(req);
    const refreshToken = this.resolveRefreshToken(req, body);
    clearRefreshTokenCookie(res, isSecureRequest(req));
    if (refreshToken) {
      await this.runInRequestTenant(req, (manager) => this.auth.revokeToken(refreshToken, req?.tenant?.id, manager));
    }
    return { ok: true };
  }

  private resolveRefreshToken(req: any, body?: { refresh_token?: string }): string | undefined {
    const cookieToken = parseCookieValue(req?.headers?.cookie as string | undefined, REFRESH_TOKEN_COOKIE_NAME);
    const bodyToken = body?.refresh_token?.trim();
    if (cookieToken && cookieToken.trim() !== '') return cookieToken;
    if (bodyToken && bodyToken !== '') return bodyToken;
    return undefined;
  }

  private toTokenResponse(tokens: TokenResponse & { refresh_token?: string }): TokenResponse {
    return {
      access_token: tokens.access_token,
      expires_in: tokens.expires_in,
      refresh_expires_in: tokens.refresh_expires_in,
    };
  }

}
