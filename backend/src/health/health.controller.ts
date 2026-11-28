import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DataSource } from 'typeorm';
import { Public } from '../auth/public.decorator';
import { markdownWorkersStatus } from '../common/markdown-worker';
import { ReadinessCheck, dataSourceReadiness } from './readiness';

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
 *
 * Readiness (`/health/ready`, readiness.ts): whether the process may receive traffic, from the
 * database and the migrations. Skipped by the tenancy middleware and public, like the liveness
 * route.
 */
@Controller('health')
export class HealthController {
  private readonly readiness: ReadinessCheck;

  constructor(dataSource: DataSource) {
    this.readiness = new ReadinessCheck(dataSourceReadiness(dataSource));
  }

  @Public()
  @Get()
  get() {
    return { status: 'ok', text_processing: markdownWorkersStatus() };
  }

  @Public()
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const result = await this.readiness.check();
    res.status(result.statusCode);
    return result.body;
  }
}
