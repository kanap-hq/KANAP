import { BadRequestException, Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { contentDisposition } from '../common/content-disposition';
import { Tenant, TenantRequest } from '../common/decorators';
import { RATE_LIMITS } from '../common/rate-limit';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { ClientAbortedError } from '../common/request-finalizer.middleware';
import { AUDIT_LOG_EXPORT_TRUNCATED_HEADER, AuditLogsService } from './audit-logs.service';

/**
 * Writes one part of a streamed answer and waits until the client has taken it when the socket's
 * buffer is full, so a slow client holds back the next database read instead of filling memory.
 * Rejects with ClientAbortedError when the connection is gone.
 */
function writePart(res: Response, part: string): Promise<void> {
  if (res.destroyed || res.writableEnded) return Promise.reject(new ClientAbortedError());
  if (res.write(part)) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const settle = (error?: Error) => {
      res.off('drain', onDrain);
      res.off('close', onClose);
      if (error) reject(error);
      else resolve();
    };
    const onDrain = () => settle();
    const onClose = () => settle(new ClientAbortedError());
    res.once('drain', onDrain);
    res.once('close', onClose);
  });
}

@UseGuards(JwtAuthGuard)
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly svc: AuditLogsService) {}

  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  @Get()
  list(@Query() query: any, @Tenant() ctx: TenantRequest) {
    return this.svc.list(query, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  @Get('filter-values')
  listFilterValues(@Query() query: any, @Tenant() ctx: TenantRequest) {
    return this.svc.listFilterValues(query, { manager: ctx.manager });
  }

  // The list's rows as a CSV file, same query as `GET /audit-logs`. Declared before ':id'.
  // Recorded in the audit log itself, like every `/export` route (export-events.interceptor.ts).
  // Written to the client batch by batch while the request's tenant transaction stays open: the
  // handler returns, and the transaction is committed, after the last part.
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequireLevel('users', 'admin')
  @Throttle({ default: RATE_LIMITS.documentExport })
  @Get('export')
  async export(
    @Query() query: any,
    @Tenant() ctx: TenantRequest,
    @Res() res: Response,
  ): Promise<void> {
    if (!ctx.manager) throw new BadRequestException('The audit log export needs a tenant.');
    const result = await this.svc.exportCsv(query, { manager: ctx.manager, tenantId: ctx.tenantId });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(result.filename));
    if (result.truncated) res.setHeader(AUDIT_LOG_EXPORT_TRUNCATED_HEADER, String(result.limit));
    try {
      for await (const part of result.chunks) await writePart(res, part);
    } catch (error) {
      // The status went out with the first part, so the answer can no longer become an error:
      // closing the connection marks the file as incomplete for the client. The error still
      // rolls the request back and reaches the exception filter, which logs it.
      if (res.headersSent) res.destroy();
      throw error;
    }
    res.end();
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  @Get(':id')
  getById(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.svc.getById(id, { manager: ctx.manager });
  }
}
