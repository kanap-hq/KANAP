import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenancyManager } from './tenancy.manager';
import { answerTenantLookupFailed } from './request-tenancy.middleware';

/**
 * Routes that should bypass tenant resolution.
 * These are public routes that don't require tenant context.
 */
const PUBLIC_ROUTES = [
  '/health',
  '/api/health',
  '/stripe/webhook',
];

/**
 * Middleware that resolves tenant context from the request host.
 *
 * This middleware:
 * 1. Skips public routes that don't require tenant context
 * 2. Resolves tenant from the host header subdomain
 * 3. Sets the context on TenancyManager
 * 4. Attaches tenant info to request for legacy compatibility
 */
@Injectable()
export class TenancyMiddleware implements NestMiddleware {
  constructor(private readonly tenancyManager: TenancyManager) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Skip public routes
      const path = req.path || req.url || '';
      if (this.isPublicRoute(path)) {
        return next();
      }

      // Get host header
      const host = req.headers.host || '';
      if (!host) {
        return next();
      }

      // Check for platform admin host
      const platformAdminHost = (process.env.PLATFORM_ADMIN_HOST || '').toLowerCase();
      const hostWithoutPort = host.split(':')[0]?.toLowerCase() ?? '';
      if (platformAdminHost && hostWithoutPort === platformAdminHost) {
        const context = await this.tenancyManager.resolveFromHost(host);
        if (!context) {
          res.status(503).json({ error: 'PLATFORM_ADMIN_TENANT_MISSING' });
          return;
        }
        this.tenancyManager.setContext(context);
        (req as any).isPlatformHost = true;
        (req as any).tenant = {
          id: context.tenantId,
          slug: context.subdomain,
          name: context.tenantName,
        };
        return next();
      }

      // Resolve tenant from host
      const context = await this.tenancyManager.resolveFromHost(host);

      if (context) {
        // Set context in TenancyManager
        this.tenancyManager.setContext(context);

        // Attach to request for legacy compatibility
        (req as any).tenant = {
          id: context.tenantId,
          slug: context.subdomain,
          name: context.tenantName,
        };
      } else {
        (req as any).tenant = null;
      }
    } catch (error) {
      // The lookup failed (pool exhausted, database down): 503 busy. Going on without a
      // tenant would answer with fake 401s and "Tenant context is required".
      answerTenantLookupFailed(req, res, error);
      return;
    }
    return next();
  }

  /**
   * Check if the given path is a public route that should skip tenant resolution.
   */
  private isPublicRoute(path: string): boolean {
    const normalizedPath = path.split('?')[0] || ''; // Remove query string
    return PUBLIC_ROUTES.some(
      (route) => normalizedPath === route || normalizedPath.startsWith(route + '/'),
    );
  }
}
