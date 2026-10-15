import { Injectable, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { BulkDeleteResult } from '../common/delete.types';
import { withSavepoint } from '../common/savepoint.util';
import { checkIds, lineUsages, RecordInUseException, refusalDetails, refusalsFrom, type DeleteRefusal } from '../common/record-in-use';
import { calendarUsageText, WorkingDayProfileContext, WorkingDayProfilesService, type WorkingDayProfileUsage } from './working-day-profiles.service';

/** The refusal of a calendar's delete (`CALENDAR_IN_USE`: the budget lines counted, disable it instead), or null. */
export function calendarDeleteRefusal(name: string, usage: WorkingDayProfileUsage | undefined): RecordInUseException | null {
  const lines = calendarUsageText(usage);
  if (!lines) return null;
  return new RecordInUseException('CALENDAR_IN_USE', 'calendar', name, lineUsages(usage), `${name} is used by ${lines}. Disable it instead.`);
}

@Injectable()
export class WorkingDayProfilesDeleteService {
  constructor(
    private readonly calendars: WorkingDayProfilesService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Deletes one calendar. A calendar used by a quantity × price line is
   * refused with a readable 409 naming the budget lines; disabling stays
   * possible.
   */
  async delete(id: string, ctx: WorkingDayProfileContext): Promise<void> {
    // The row lock comes before the count: a line naming the calendar
    // concurrently either committed first (and is counted) or waits for this
    // delete and then fails its key check.
    const [existing] = await this.calendars.lockByIds(ctx, [id]);
    if (!existing) throw new NotFoundException('Calendar not found.');
    const refusal = calendarDeleteRefusal(existing.name, (await this.calendars.countUsage(ctx, [id])).get(id));
    if (refusal) throw refusal;

    try {
      await ctx.manager.query(`DELETE FROM working_day_profiles WHERE tenant_id = $1 AND id = $2`, [ctx.tenantId, id]);
    } catch (err: any) {
      if (err?.code === '23503') {
        throw new RecordInUseException('RECORD_IN_USE', 'calendar', existing.name, [], `${existing.name} is still used by budget lines. Disable it instead.`);
      }
      throw err;
    }

    await this.audit.log(
      {
        table: 'working_day_profiles',
        recordId: id,
        action: 'delete',
        before: existing,
        after: null,
        userId: ctx.userId ?? null,
        source: ctx.audit?.source,
        sourceRef: ctx.audit?.sourceRef ?? null,
      },
      { manager: ctx.manager },
    );
  }

  /** The check before a delete (`POST /working-day-profiles/delete-check`): which of `ids` would be refused, and why. Nothing is written. */
  async deleteCheck(ids: string[], ctx: WorkingDayProfileContext): Promise<{ refused: DeleteRefusal[] }> {
    const wanted = checkIds(ids);
    if (wanted.length === 0) return { refused: [] };
    const rows: Array<{ id: string; name: string }> = await ctx.manager.query(
      `SELECT id, name FROM working_day_profiles WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [ctx.tenantId, wanted],
    );
    const usage = await this.calendars.countUsage(ctx, wanted);
    return refusalsFrom(wanted, rows, (row) => row.name, async (row) => calendarDeleteRefusal(row.name, usage.get(row.id)));
  }

  /** Deletes each calendar under its own savepoint, so a refusal leaves the others deleted and the transaction usable. */
  async bulkDelete(ids: string[], ctx: WorkingDayProfileContext): Promise<BulkDeleteResult> {
    const result: BulkDeleteResult = { deleted: [], failed: [] };
    const unique = Array.from(new Set((ids ?? []).map((id) => String(id))));
    for (const id of unique) {
      if (!isUUID(id)) {
        result.failed.push({ id, name: 'Unknown', reason: 'Calendar not found.', code: 'not_found' });
        continue;
      }
      try {
        await withSavepoint(ctx.manager, () => this.delete(id, ctx));
        result.deleted.push(id);
      } catch (err: any) {
        const [row] = await ctx.manager.query(
          `SELECT name FROM working_day_profiles WHERE tenant_id = $1 AND id = $2`,
          [ctx.tenantId, id],
        );
        result.failed.push({ id, name: row?.name ?? 'Unknown', reason: err?.message || 'Unknown error', ...refusalDetails(err) });
      }
    }
    return result;
  }
}
