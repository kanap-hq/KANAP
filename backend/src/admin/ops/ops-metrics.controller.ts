import { CanActivate, Controller, ExecutionContext, Get, Header, Injectable, NotFoundException, UnauthorizedException, UseGuards } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Public } from '../../auth/public.decorator';
import { OpsSnapshotService } from './ops-snapshot.service';
import { configuredOpsMetricsToken } from './ops-metrics-token';
import type { OpsSnapshotDto } from './dto/ops-snapshot.dto';
import type { ErrorEntry } from './ops-metrics.store';

/** The snapshot as the monitoring token reads it: the recent errors without their messages. */
export type MonitoringSnapshot = Omit<OpsSnapshotDto, 'recentErrors'> & { recentErrors: Array<Omit<ErrorEntry, 'errorMessage'>> };

/**
 * The ops snapshot for a monitoring tool, in both deployment modes: on-premise has no platform
 * console, so `GET /admin/ops/snapshot` is out of reach there. Enabled by `OPS_METRICS_TOKEN`
 * (ops-metrics-token.ts); without it the route does not exist (404). The probe sends
 * `Authorization: Bearer <token>`. No tenant lookup (the tenancy middleware skips this path), no
 * tenant transaction (`@Public()`); the database reads of the snapshot are best effort (1 s), so
 * it answers when the pool is saturated. The error messages of the recent 5xx are left out (they
 * can quote internals); the platform console keeps them.
 */

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

@Injectable()
export class OpsMetricsTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const token = configuredOpsMetricsToken();
    if (!token) throw new NotFoundException();
    const header = String(context.switchToHttp().getRequest()?.headers?.authorization ?? '');
    if (!header.startsWith('Bearer ')) {
      throw new UnauthorizedException({ code: 'MISSING_TOKEN', message: 'Missing token' });
    }
    // Same-length digests: the comparison takes the same time whatever the guess.
    if (!timingSafeEqual(digest(header.slice('Bearer '.length).trim()), digest(token))) {
      throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Invalid token' });
    }
    return true;
  }
}

@Controller('ops')
export class OpsMetricsController {
  constructor(private readonly snapshots: OpsSnapshotService) {}

  @Public()
  @UseGuards(OpsMetricsTokenGuard)
  @Get('metrics')
  @Header('Cache-Control', 'no-store')
  async metrics(): Promise<MonitoringSnapshot> {
    const snapshot = await this.snapshots.build();
    return {
      ...snapshot,
      recentErrors: snapshot.recentErrors.map(({ errorType, count, lastSeen, route }) => ({ errorType, count, lastSeen, route })),
    };
  }
}
