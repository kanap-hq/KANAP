import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { SKIP_TENANT_TRANSACTION_KEY } from './skip-tenant-transaction.decorator';
import { connectRequestRunner, rememberRequestDbTimeouts, resolveRequestDbTimeouts, startTenantTransaction } from './request-db-timeouts';

@Injectable()
export class TenantInitGuard implements CanActivate {
  constructor(
    private readonly dataSource: DataSource,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const skipTenantTransaction = this.reflector.getAllAndOverride<boolean>(
      SKIP_TENANT_TRANSACTION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skipTenantTransaction) return true;

    const req: any = context.switchToHttp().getRequest();
    const tenantId: string | undefined = req?.tenant?.id;
    if (!tenantId) return true; // public/apex requests

    // Create QueryRunner and set tenant context BEFORE other guards run.
    // This is required for PermissionGuard to query role_permissions with proper RLS context.
    // The transaction carries the route's bounded waits (see request-db-timeouts.ts).
    // No free connection: 503 busy (connectRequestRunner), not a 500.
    if (!req.queryRunner) {
      const runner = this.dataSource.createQueryRunner();
      await connectRequestRunner(runner);
      try {
        const timeouts = resolveRequestDbTimeouts(this.reflector, context);
        await startTenantTransaction(runner, tenantId, timeouts);
        rememberRequestDbTimeouts(req, timeouts);
      } catch (error) {
        // Not on the request yet: nobody else would give the connection back.
        if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
        await runner.release().catch(() => undefined);
        throw error;
      }
      req.queryRunner = runner;
      req._tenantRunnerOwner = true; // Mark that this guard owns the runner
    }

    return true;
  }
}
