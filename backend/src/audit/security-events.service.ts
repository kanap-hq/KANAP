import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { NeverRejects } from '../common/never-rejects';
import { withTenant } from '../common/tenant-runner';
import { writeAuditLog } from './audit.service';
import { AuthEvent, authEventEntry } from './security-events';

/** Writes the sign-in and session events (security-events.ts) to the tenant's audit log. */
@Injectable()
export class SecurityEventsService {
  private readonly logger = new Logger(SecurityEventsService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Records one event in the audit log of `tenantId`, in a transaction of its own: a refused
   * sign-in rolls the request's transactions back, and its event must stay. Callers do not
   * await it, so the response never waits for the write; a failed write is a warning line and
   * never reaches the client (NeverRejects). The row is built before anything is awaited, from
   * the request as it is at the call. Without a tenant (unknown host) nothing is written.
   */
  @NeverRejects()
  async recordAuthEvent(tenantId: string | null | undefined, event: AuthEvent, req: unknown): Promise<void> {
    const entry = authEventEntry(event, req as Parameters<typeof authEventEntry>[1]);
    if (!entry || typeof tenantId !== 'string' || !tenantId) return;
    await withTenant(this.dataSource, tenantId, (manager) => writeAuditLog(manager, entry));
  }
}
