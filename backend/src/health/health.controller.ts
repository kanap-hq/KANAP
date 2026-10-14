import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { markdownWorkersStatus } from '../common/markdown-worker';

/**
 * Liveness: answers as long as the process serves requests. No tenant lookup (the tenancy
 * middleware skips it, request-tenancy.middleware.ts) and no tenant transaction (`@Public()`),
 * so a monitor or an orchestrator polling it costs no database connection, and a saturated
 * pool does not make a busy API look dead.
 *
 * `text_processing` says whether the Markdown workers answer (`ready`), are
 * `starting`, or are `unavailable`: rich-text writes are then refused (503
 * MARKDOWN_UNAVAILABLE) while the rest of the API keeps serving, so the route
 * still answers 200.
 */
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  get() {
    return { status: 'ok', text_processing: markdownWorkersStatus() };
  }
}
