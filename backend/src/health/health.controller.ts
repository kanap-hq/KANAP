import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';

/**
 * Liveness: answers as long as the process serves requests. No tenant lookup (the tenancy
 * middleware skips it, request-tenancy.middleware.ts) and no tenant transaction (`@Public()`),
 * so a monitor or an orchestrator polling it costs no database connection, and a saturated
 * pool does not make a busy API look dead.
 */
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  get() {
    return { status: 'ok' };
  }
}
