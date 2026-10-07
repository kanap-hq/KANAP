import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, IsNull } from 'typeorm';
import { UsersService } from '../users/users.service';
import * as argon2 from 'argon2';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import { createPasswordResetToken as buildPasswordResetToken, getPasswordResetExpirationMinutes } from './password-reset.util';
import { ACCESS_TOKEN_PURPOSE, PASSWORD_RESET_PURPOSE } from './access-token.util';
import { getPasswordResetSecret } from './token-secret.util';
import {
  DEFAULT_ACCESS_TOKEN_TTL,
  DEFAULT_REFRESH_TOKEN_TTL,
  parseDurationMs,
  parseDurationSec,
} from './token-ttl.util';
import { RefreshToken } from './refresh-token.entity';
import { PasswordResetToken } from './password-reset-token.entity';
import { requireJwtSecret } from '../common/env';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Access-token claims. `purpose` is the explicit type marker `JwtAuthGuard` requires since the
 * constat n°2 fix (RFC 8725 §3.12): without it, any other family signed by this application —
 * a password-reset link above all — verifies as a valid access token.
 */
export function buildAccessTokenPayload(user: { id: string; email: string; role?: any; tenant_id?: string | null }) {
  return {
    purpose: ACCESS_TOKEN_PURPOSE,
    sub: user.id,
    email: user.email,
    role: user.role,
    tenant_id: user.tenant_id ?? null,
  };
}

function bindTenantId(tenantId: string | null | undefined): string {
  return tenantId ?? '';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: Repository<RefreshToken>,
    @InjectRepository(PasswordResetToken)
    private readonly passwordResetTokenRepo: Repository<PasswordResetToken>,
  ) {}

  async validateUser(email: string, password: string, manager?: import('typeorm').EntityManager) {
    if (!password || typeof password !== 'string') throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' });
    const user = await this.users.findByEmailForSignIn(email, { manager });
    if (!user || !user.password_hash || typeof user.password_hash !== 'string') {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' });
    }
    if (process.env.APP_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.log('login attempt', {
        email,
        hasHash: !!user.password_hash,
        hashType: typeof user.password_hash,
        passType: typeof password,
      });
    }
    let ok = false;
    try {
      ok = await argon2.verify(user.password_hash as string, password);
    } catch {
      ok = false;
    }
    if (!ok) throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' });
    if (user.status !== 'enabled') throw new UnauthorizedException({ code: 'USER_DISABLED', message: 'User disabled' });
    if (!user.role) throw new UnauthorizedException({ code: 'USER_DISABLED', message: 'User disabled' });
    const roleName = (user.role.role_name ?? '').toLowerCase();
    const isSystemRole = !!user.role.is_system;
    const canLogin = roleName === 'administrator' || !isSystemRole;
    if (!canLogin) throw new UnauthorizedException({ code: 'USER_DISABLED', message: 'User disabled' });
    return user;
  }

  /**
   * Sign both access token and refresh token for a user.
   * Access token: short-lived (default 15m)
   * Refresh token: longer-lived with sliding expiration (default 4h)
   */
  async signTokens(
    user: { id: string; email: string; role?: any; tenant_id?: string | null },
    manager?: import('typeorm').EntityManager,
  ): Promise<{ access_token: string; refresh_token: string; expires_in: number; refresh_expires_in: number }> {
    const secret = requireJwtSecret();
    const accessTtl = process.env.JWT_ACCESS_TOKEN_TTL || DEFAULT_ACCESS_TOKEN_TTL;
    const refreshTtl = process.env.JWT_REFRESH_TOKEN_TTL || DEFAULT_REFRESH_TOKEN_TTL;

    const accessExpiresInSec = parseDurationSec(accessTtl);
    const refreshExpiresInSec = parseDurationSec(refreshTtl);
    const refreshExpiresInMs = parseDurationMs(refreshTtl);

    // Sign access token
    const payload = buildAccessTokenPayload(user);
    const accessToken = jwt.sign(payload, secret, { expiresIn: accessExpiresInSec });

    // Generate refresh token (random bytes)
    const refreshTokenRaw = crypto.randomBytes(32).toString('hex');
    const refreshTokenHash = hashToken(refreshTokenRaw);

    // Store refresh token in database
    const repo = manager ? manager.getRepository(RefreshToken) : this.refreshTokenRepo;
    const refreshTokenEntity = repo.create({
      user_id: user.id,
      token_hash: refreshTokenHash,
      expires_at: new Date(Date.now() + refreshExpiresInMs),
      tenant_id: bindTenantId(user.tenant_id),
    });
    await repo.save(refreshTokenEntity);

    return {
      access_token: accessToken,
      refresh_token: refreshTokenRaw,
      expires_in: accessExpiresInSec,
      refresh_expires_in: refreshExpiresInSec,
    };
  }

  /**
   * Legacy method for backwards compatibility (e.g., provisioning token exchange)
   */
  signToken(user: { id: string; email: string; role?: any; tenant_id?: string | null }) {
    const secret = requireJwtSecret();
    const accessTtl = process.env.JWT_ACCESS_TOKEN_TTL || DEFAULT_ACCESS_TOKEN_TTL;
    const accessExpiresInSec = parseDurationSec(accessTtl);
    const payload = buildAccessTokenPayload(user);
    const token = jwt.sign(payload, secret, { expiresIn: accessExpiresInSec });
    return { access_token: token };
  }

  /**
   * Refresh an access token using a valid refresh token.
   * Extends the refresh token's expiration (sliding window).
   */
  async refreshAccessToken(
    refreshToken: string,
    tenantId: string | null | undefined,
    manager?: import('typeorm').EntityManager,
  ): Promise<{ access_token: string; expires_in: number; refresh_expires_in: number }> {
    const tokenHash = hashToken(refreshToken);
    const repo = manager ? manager.getRepository(RefreshToken) : this.refreshTokenRepo;

    const storedToken = await repo.findOne({
      where: { token_hash: tokenHash, tenant_id: bindTenantId(tenantId) },
      relations: ['user', 'user.role'],
    });

    if (!storedToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (storedToken.expires_at < new Date()) {
      // Token expired, delete it
      await repo.delete({ id: storedToken.id });
      throw new UnauthorizedException('Refresh token expired');
    }

    const user = storedToken.user;
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    if (user.status !== 'enabled') {
      // A disabled user must not be able to mint new access tokens.
      await repo.delete({ id: storedToken.id });
      throw new UnauthorizedException({ code: 'USER_DISABLED', message: 'User disabled' });
    }

    // Extend refresh token expiration (sliding window)
    const refreshTtl = process.env.JWT_REFRESH_TOKEN_TTL || DEFAULT_REFRESH_TOKEN_TTL;
    const refreshExpiresInMs = parseDurationMs(refreshTtl);
    const refreshExpiresInSec = parseDurationSec(refreshTtl);
    storedToken.expires_at = new Date(Date.now() + refreshExpiresInMs);
    await repo.save(storedToken);

    // Generate new access token
    const secret = requireJwtSecret();
    const accessTtl = process.env.JWT_ACCESS_TOKEN_TTL || DEFAULT_ACCESS_TOKEN_TTL;
    const accessExpiresInSec = parseDurationSec(accessTtl);

    const payload = buildAccessTokenPayload({
      id: user.id,
      email: user.email,
      role: user.role,
      tenant_id: storedToken.tenant_id,
    });
    const accessToken = jwt.sign(payload, secret, { expiresIn: accessExpiresInSec });

    return {
      access_token: accessToken,
      expires_in: accessExpiresInSec,
      refresh_expires_in: refreshExpiresInSec,
    };
  }

  /**
   * Revoke a specific refresh token (logout from one device).
   */
  async revokeToken(
    refreshToken: string,
    tenantId: string | null | undefined,
    manager?: import('typeorm').EntityManager,
  ): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    const repo = manager ? manager.getRepository(RefreshToken) : this.refreshTokenRepo;
    await repo.delete({ token_hash: tokenHash, tenant_id: bindTenantId(tenantId) });
  }

  /**
   * Revoke all refresh tokens for a user (logout from all devices).
   */
  async revokeAllTokens(userId: string, manager?: import('typeorm').EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(RefreshToken) : this.refreshTokenRepo;
    await repo.delete({ user_id: userId });
  }

  /**
   * Clean up expired refresh tokens (can be run periodically).
   */
  async cleanupExpiredTokens(manager?: import('typeorm').EntityManager): Promise<number> {
    const repo = manager ? manager.getRepository(RefreshToken) : this.refreshTokenRepo;
    const result = await repo.delete({ expires_at: LessThan(new Date()) });
    return result.affected || 0;
  }

  async createPasswordResetToken(
    user: { id: string; email: string; tenant_id?: string },
    manager?: import('typeorm').EntityManager,
  ) {
    const jti = crypto.randomBytes(16).toString('hex');
    const token = buildPasswordResetToken(user, jti);
    const decoded = jwt.decode(token) as { exp?: number } | null;
    const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 60 * 60 * 1000);
    const repo = manager ? manager.getRepository(PasswordResetToken) : this.passwordResetTokenRepo;
    await repo.save(repo.create({
      tenant_id: bindTenantId(user.tenant_id),
      user_id: user.id,
      token_hash: hashToken(token),
      expires_at: expiresAt,
      used_at: null,
    }));
    return token;
  }

  async resetPasswordWithToken(token: string, nextPassword: string, opts?: { manager?: import('typeorm').EntityManager }) {
    const secret = getPasswordResetSecret();
    let payload: any;
    try {
      payload = jwt.verify(token, secret);
    } catch {
      throw new BadRequestException('invalid or expired token');
    }
    if (!payload || payload.purpose !== PASSWORD_RESET_PURPOSE || typeof payload.sub !== 'string' || typeof payload.jti !== 'string') {
      throw new BadRequestException('invalid token payload');
    }
    const resetRepo = opts?.manager ? opts.manager.getRepository(PasswordResetToken) : this.passwordResetTokenRepo;
    const tokenHash = hashToken(token);
    const resetToken = await resetRepo.findOne({
      where: {
        token_hash: tokenHash,
        tenant_id: bindTenantId(payload.tenant_id),
        used_at: IsNull(),
      },
    });
    if (!resetToken || resetToken.expires_at < new Date()) {
      throw new BadRequestException('invalid or expired token');
    }
    const consumed = await resetRepo.update(
      { id: resetToken.id, used_at: IsNull() },
      { used_at: new Date() },
    );
    if (!consumed.affected) {
      throw new BadRequestException('invalid or expired token');
    }
    const user = await this.users.findById(payload.sub, { manager: opts?.manager });
    if (!user) {
      throw new BadRequestException('user cannot reset password');
    }
    const roleName = (user.role?.role_name ?? '').toLowerCase();
    const isContactRole = roleName === 'contact';
    // Accounts managed by an external identity provider (Entra) never hold a local
    // password; letting them set one would create a second, unmanaged sign-in path.
    const isExternallyManaged = !!user.external_auth_provider;
    const allowedStatuses = new Set(['enabled', 'invited']);
    if (isContactRole || isExternallyManaged || !allowedStatuses.has(user.status)) {
      throw new BadRequestException('user cannot reset password');
    }
    await this.users.updateUser(user.id, { password: nextPassword }, null, { manager: opts?.manager });
    if (user.status !== 'enabled') {
      await this.users.enableUser(user.id, null, { manager: opts?.manager });
    }
    await this.revokeAllTokens(user.id, opts?.manager);
  }

  getPasswordResetExpirationMinutes() {
    return getPasswordResetExpirationMinutes();
  }
}
