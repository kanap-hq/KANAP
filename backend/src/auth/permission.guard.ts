import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource, EntityManager } from 'typeorm';
import {
  READ_ONLY_ROUTE_KEY,
  REQUIRE_LEVEL_KEY,
  REQUIRE_ANY_LEVEL_KEY,
  RequireAnyLevelMeta,
  RequireLevelMeta,
} from './require-level.decorator';
import { UsersService } from '../users/users.service';
import { PermissionsService } from '../permissions/permissions.service';
import { UserRole } from '../users/user-role.entity';
import { StripeConfigService } from '../billing/stripe/stripe.config';
import { Subscription } from '../billing/subscription.entity';
import { evaluateSubscriptionAccess } from '../billing/subscription-freeze.util';

const RANK: Record<string, number> = { reader: 1, contributor: 2, member: 3, admin: 4 };

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly users: UsersService,
    private readonly perms: PermissionsService,
    private readonly dataSource: DataSource,
    private readonly stripeConfig: StripeConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredMeta = this.reflector.getAllAndOverride<RequireLevelMeta | undefined>(REQUIRE_LEVEL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const anyMeta = this.reflector.getAllAndOverride<RequireAnyLevelMeta | undefined>(
      REQUIRE_ANY_LEVEL_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredMeta && (!anyMeta || anyMeta.length === 0)) return true; // no requirement specified

    const req = context.switchToHttp().getRequest();
    const userJwt = req.user as { sub?: string; email?: string; role?: string } | undefined;
    if (!userJwt?.sub) return false;

    const manager: EntityManager = (req as any)?.queryRunner?.manager ?? this.dataSource.manager;
    const user = await this.users.findById(userJwt.sub, { manager });
    if (!user) return false;
    if (user.status !== 'enabled') {
      // 401 (not 403) so the client goes through refresh → logout; the refresh
      // endpoint re-checks status too, so the session ends here for good.
      throw new UnauthorizedException({ code: 'USER_DISABLED', message: 'User disabled' });
    }

    // Load all roles for this user (multi-role support)
    const userRolesRepo = manager.getRepository(UserRole);
    const userRoles = await userRolesRepo.find({
      where: { user_id: user.id },
      relations: ['role'],
    });

    // Collect all role IDs (include legacy role_id for backwards compatibility)
    const roleIds = new Set<string>();
    if (user.role_id) roleIds.add(user.role_id);
    for (const ur of userRoles) roleIds.add(ur.role_id);

    // Check if any role is Administrator
    const roleNames = userRoles.map(ur => ur.role?.role_name?.toLowerCase() ?? '');
    if (user.role?.role_name) roleNames.push(user.role.role_name.toLowerCase());
    const isAdmin = roleNames.includes('administrator');

    let currentLevel: string | undefined = isAdmin ? 'admin' : undefined;
    let freezeMeta: RequireLevelMeta | undefined = requiredMeta;
    let permissions: Record<string, string> = {};
    if (isAdmin && !requiredMeta && anyMeta && anyMeta.length > 0) {
      freezeMeta = anyMeta[0];
    }

    // If not administrator, check role-based permissions
    if (!isAdmin) {
      const map = await this.perms.listForRoles(Array.from(roleIds), { manager });
      if (map.size === 0) {
        // Authenticated user whose roles grant nothing at all (e.g. a JIT-provisioned
        // SSO user still waiting for access). Distinct body so the frontend can show
        // a "your account has not been granted access yet" page instead of a generic 403.
        throw new ForbiddenException({ error: 'NO_ACCESS', message: 'This account has not been granted access yet.' });
      }
      const hasRequiredLevel = (resource: string, level: string) => {
        const current = map.get(resource);
        if (!current) return false;
        return (RANK[current] ?? 0) >= (RANK[level] ?? 99);
      };

      if (requiredMeta) {
        if (!hasRequiredLevel(requiredMeta.resource, requiredMeta.level)) return false;
        currentLevel = map.get(requiredMeta.resource);
        freezeMeta = requiredMeta;
      }

      if (anyMeta && anyMeta.length > 0) {
        const matchedAny = anyMeta.find((entry) => hasRequiredLevel(entry.resource, entry.level));
        if (!matchedAny) return false;
        if (!requiredMeta) {
          currentLevel = map.get(matchedAny.resource);
          freezeMeta = matchedAny;
        }
      }
      permissions = Object.fromEntries(map);
    }

    req.isAdmin = isAdmin;
    req.permissionLevel = currentLevel;
    req.permissions = permissions;

    // --- Freeze enforcement ---
    if (freezeMeta) {
      await this.enforceFreezeIfNeeded(context, req, user, freezeMeta, manager);
    }

    return true;
  }

  private async enforceFreezeIfNeeded(
    context: ExecutionContext,
    req: any,
    user: any,
    meta: RequireLevelMeta,
    manager: DataSource['manager'],
  ): Promise<void> {
    // Skip freeze entirely if Stripe is not configured (on-prem bypass)
    if (!this.stripeConfig.isConfigured()) return;

    // Skip for read-only methods, and for the POST routes that only read (`@ReadOnlyRoute()`)
    const method = req.method?.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
    // On the handler only: a controller-wide mark would exempt its writes too.
    if (this.reflector.get<boolean | undefined>(READ_ONLY_ROUTE_KEY, context.getHandler())) return;

    // Skip for platform host requests
    if (req.isPlatformHost) return;

    // Skip for billing resource routes
    if (meta.resource === 'billing') return;

    // Load tenant subscription
    const tenantId = req.tenant?.id;
    if (!tenantId) {
      throw new ForbiddenException({ error: 'SUBSCRIPTION_FROZEN', message: 'No active subscription found.' });
    }

    const subscription = await manager.getRepository(Subscription).findOne({
      where: { tenant_id: tenantId },
      order: { created_at: 'DESC' },
    });

    // Stripe is configured here (early-returned above otherwise), so a missing
    // subscription is treated as frozen. Shared with the AI/agent freeze gate.
    const decision = evaluateSubscriptionAccess(subscription, Date.now(), true);
    if (!decision.allowed) {
      throw new ForbiddenException({ error: decision.reason, message: decision.message });
    }
  }
}
