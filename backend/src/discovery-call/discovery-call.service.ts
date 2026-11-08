import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { writeAuditLog } from '../audit/audit.service';
import { withTenant } from '../common/tenant-runner';

/**
 * The discovery call of a trial workspace (`doc/discovery-call.md`): one row per tenant in
 * `trial_discovery_calls`, written by the Cal.com webhook or by hand (platform administration),
 * read by the trial e-mails and the trial funnel. The button clicks are audit entries only.
 *
 * Audit log (`table_name = 'trial'`, `record_id` = the tenant):
 * - `trial.discovery_call_clicked` `{ placement }`, one entry per click;
 * - `trial.discovery_call_updated` before and after `{ scheduled_at, status, source, note }`;
 * - `trial.discovery_call_removed` before.
 *
 * Every method that takes a manager runs in its transaction, which carries the tenant, and names
 * `tenant_id` in each query.
 */

export const DISCOVERY_CALL_AUDIT_TABLE = 'trial';

export const DISCOVERY_CALL_PLACEMENTS = ['last_step', 'about', 'mail_j0', 'mail_j5', 'mail_j12', 'trial_end'] as const;
export type DiscoveryCallPlacement = typeof DISCOVERY_CALL_PLACEMENTS[number];

export const DISCOVERY_CALL_STATUSES = ['booked', 'cancelled'] as const;
export type DiscoveryCallStatus = typeof DISCOVERY_CALL_STATUSES[number];
export type DiscoveryCallSource = 'calcom' | 'manual';

export type DiscoveryCall = {
  scheduled_at: string | null;
  status: DiscoveryCallStatus;
  source: DiscoveryCallSource;
  note: string | null;
  /** The Cal.com booking uid; null for a call set by hand. */
  external_id: string | null;
  updated_at: string;
};

/** What the trial e-mails need: a call is booked, to come or past (J+5 is then not sent). */
export function discoveryCallBooked(call: DiscoveryCall | null): boolean {
  return call?.status === 'booked';
}

export function isDiscoveryCallPlacement(value: unknown): value is DiscoveryCallPlacement {
  return typeof value === 'string' && (DISCOVERY_CALL_PLACEMENTS as readonly string[]).includes(value);
}

/** The Cal.com signature: HMAC-SHA256 of the raw body with the shared secret, in hex (`x-cal-signature-256`). */
export function validCalcomSignature(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(signature.trim().toLowerCase(), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type DiscoveryCallInput = {
  scheduled_at: Date | null;
  status: DiscoveryCallStatus;
  source: DiscoveryCallSource;
  note?: string | null;
  external_id?: string | null;
};

const NOTE_MAX = 2000;

type Row = {
  scheduled_at: Date | string | null;
  status: DiscoveryCallStatus;
  source: DiscoveryCallSource;
  note: string | null;
  external_id: string | null;
  updated_at: Date | string;
};

const iso = (value: Date | string | null): string | null =>
  (value === null ? null : (value instanceof Date ? value : new Date(value)).toISOString());

const CALCOM_EVENTS = new Set(['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED']);

export type CalcomOutcome = 'applied' | 'ignored';

@Injectable()
export class DiscoveryCallService {
  private readonly logger = new Logger(DiscoveryCallService.name);

  constructor(private readonly dataSource: DataSource) {}

  async read(manager: EntityManager, tenantId: string): Promise<DiscoveryCall | null> {
    const [row]: Row[] = await manager.query(
      `SELECT scheduled_at, status, source, note, external_id, updated_at
         FROM trial_discovery_calls WHERE tenant_id = $1`,
      [tenantId],
    );
    if (!row) return null;
    return {
      scheduled_at: iso(row.scheduled_at),
      status: row.status,
      source: row.source,
      note: row.note,
      external_id: row.external_id,
      updated_at: iso(row.updated_at)!,
    };
  }

  /** Writes the tenant's call (one row, replaced) and its audit entry. `userId` null for the webhook. */
  async save(manager: EntityManager, tenantId: string, input: DiscoveryCallInput, userId: string | null = null): Promise<DiscoveryCall> {
    const before = await this.read(manager, tenantId);
    await manager.query(
      `INSERT INTO trial_discovery_calls (tenant_id, scheduled_at, status, source, note, external_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id) DO UPDATE SET
         scheduled_at = EXCLUDED.scheduled_at, status = EXCLUDED.status, source = EXCLUDED.source,
         note = EXCLUDED.note, external_id = EXCLUDED.external_id, updated_at = now()`,
      [tenantId, input.scheduled_at, input.status, input.source, input.note ?? null, input.external_id ?? null],
    );
    const after = (await this.read(manager, tenantId))!;
    await this.audit(manager, tenantId, userId, 'trial.discovery_call_updated', {
      before: before ? this.auditView(before) : null,
      after: this.auditView(after),
    });
    return after;
  }

  /**
   * A call set by hand: `{ scheduled_at, status?, note? }`, `scheduled_at` an ISO date, `status`
   * `booked` by default. Refused with 400 `discovery_call_invalid` otherwise.
   */
  async saveManual(manager: EntityManager, tenantId: string, body: unknown, userId: string | null = null): Promise<DiscoveryCall> {
    const value = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const scheduledAt = typeof value.scheduled_at === 'string' ? new Date(value.scheduled_at) : null;
    const status = value.status === undefined ? 'booked' : value.status;
    const note = value.note === undefined || value.note === null ? null : value.note;
    if (!scheduledAt || Number.isNaN(scheduledAt.getTime())
      || !(DISCOVERY_CALL_STATUSES as readonly unknown[]).includes(status)
      || (note !== null && (typeof note !== 'string' || note.length > NOTE_MAX))) {
      throw new BadRequestException({
        code: 'discovery_call_invalid',
        message: `Send scheduled_at as an ISO date, status as booked or cancelled, and a note of at most ${NOTE_MAX} characters.`,
      });
    }
    return this.save(manager, tenantId, {
      scheduled_at: scheduledAt,
      status: status as DiscoveryCallStatus,
      source: 'manual',
      note: typeof note === 'string' ? note.trim() || null : null,
    }, userId);
  }

  async remove(manager: EntityManager, tenantId: string, userId: string | null = null): Promise<void> {
    const before = await this.read(manager, tenantId);
    if (!before) return;
    await manager.query(`DELETE FROM trial_discovery_calls WHERE tenant_id = $1`, [tenantId]);
    await this.audit(manager, tenantId, userId, 'trial.discovery_call_removed', { before: this.auditView(before), after: null });
  }

  async recordClick(manager: EntityManager, tenantId: string, userId: string | null, placement: DiscoveryCallPlacement): Promise<void> {
    // A click from an e-mail link has no signed-in user.
    await this.audit(manager, tenantId, userId, 'trial.discovery_call_clicked', { before: null, after: { placement } }, userId ? 'user' : 'system');
  }

  /**
   * The trial workspace of an address: the most recent activated trial sign-up made with it, whose
   * tenant still exists. The sign-up address is the workspace's first administrator.
   * `trial_signups` and `tenants` carry no tenant policy: one query, no tenant context.
   */
  async findTrialTenantByEmail(email: string): Promise<string | null> {
    const address = email.trim().toLowerCase();
    if (!address) return null;
    const [row]: Array<{ id: string }> = await this.dataSource.query(
      `SELECT t.id FROM trial_signups s
         JOIN tenants t ON t.slug = s.slug AND t.deleted_at IS NULL
        WHERE s.email = $1 AND s.activated_at IS NOT NULL
        ORDER BY s.activated_at DESC
        LIMIT 1`,
      [address],
    );
    return row?.id ?? null;
  }

  /**
   * A Cal.com booking event (signature already checked). Created and rescheduled: the booking
   * becomes the tenant's call (the latest booking wins). Cancelled: the call is marked cancelled
   * when it is that booking. The tenant is the trial workspace of one of the attendees' addresses.
   * Anything else, or an address that matches no trial, is ignored.
   */
  async applyCalcomEvent(body: unknown): Promise<CalcomOutcome> {
    const event = (body && typeof body === 'object' ? body : {}) as Record<string, any>;
    const trigger = String(event.triggerEvent ?? '');
    const payload = (event.payload && typeof event.payload === 'object' ? event.payload : {}) as Record<string, any>;
    if (!CALCOM_EVENTS.has(trigger)) return 'ignored';
    const uid = typeof payload.uid === 'string' ? payload.uid : null;
    if (!uid) return 'ignored';

    const emails = [
      ...(Array.isArray(payload.attendees) ? payload.attendees.map((attendee: any) => attendee?.email) : []),
      payload.responses?.email?.value,
    ].filter((value): value is string => typeof value === 'string' && value.includes('@'));
    let tenantId: string | null = null;
    for (const email of [...new Set(emails.map((value) => value.trim().toLowerCase()))]) {
      tenantId = await this.findTrialTenantByEmail(email);
      if (tenantId) break;
    }
    if (!tenantId) {
      this.logger.log(`Cal.com ${trigger} ${uid}: no trial workspace for its attendees, ignored`);
      return 'ignored';
    }

    return withTenant(this.dataSource, tenantId, async (manager) => {
      const current = await this.read(manager, tenantId!);
      if (trigger === 'BOOKING_CANCELLED') {
        if (!current || current.external_id !== uid || current.status === 'cancelled') return 'ignored';
        await this.save(manager, tenantId!, { ...current, scheduled_at: current.scheduled_at ? new Date(current.scheduled_at) : null, status: 'cancelled' });
        return 'applied';
      }
      const start = new Date(String(payload.startTime ?? ''));
      if (Number.isNaN(start.getTime())) return 'ignored';
      await this.save(manager, tenantId!, {
        scheduled_at: start,
        status: 'booked',
        source: 'calcom',
        note: current?.note ?? null,
        external_id: uid,
      });
      return 'applied';
    });
  }

  private auditView(call: DiscoveryCall) {
    return { scheduled_at: call.scheduled_at, status: call.status, source: call.source, note: call.note };
  }

  private async audit(
    manager: EntityManager,
    tenantId: string,
    userId: string | null,
    action: string,
    { before, after }: { before: unknown; after: unknown },
    source: 'user' | 'system' | 'webhook' = userId ? 'user' : 'webhook',
  ) {
    await writeAuditLog(manager, {
      table: DISCOVERY_CALL_AUDIT_TABLE,
      recordId: tenantId,
      action,
      before,
      after,
      userId,
      source,
    });
  }
}
