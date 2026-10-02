import { CanActivate, Controller, ExecutionContext, Get, Header, Injectable, NotFoundException, UnauthorizedException, UseGuards } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Public } from '../../auth/public.decorator';
import { OpsSnapshotService } from './ops-snapshot.service';
import type { OpsSnapshotDto } from './dto/ops-snapshot.dto';

/**
 * The ops snapshot for a monitoring tool, in both deployment modes: on-premise has no platform
 * console, so `GET /admin/ops/snapshot` is out of reach there. Enabled by `OPS_METRICS_TOKEN`
 * (24 characters or more, e.g. `openssl rand -hex 32`); without it the route does not exist (404).
 * The probe sends `Authorization: Bearer <token>`. No tenant transaction, no database connection
 * beyond the pg_stat reads of the snapshot (cached 10 s).
 */
export const OPS_METRICS_TOKEN_MIN_LENGTH = 24;

export function configuredOpsMetricsToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const token = String(env.OPS_METRICS_TOKEN ?? '').trim();
  return token.length >= OPS_METRICS_TOKEN_MIN_LENGTH ? token : null;
}

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
  async metrics(): Promise<OpsSnapshotDto> {
    return this.snapshots.build();
  }
}
