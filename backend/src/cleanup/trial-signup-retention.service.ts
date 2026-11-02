import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ScheduledTasksService } from '../admin/scheduled-tasks/scheduled-tasks.service';
import { Features } from '../config/features';

export const TRIAL_SIGNUP_RETENTION_DAYS = 90;
export const TRIAL_SIGNUP_RETENTION_TASK_NAME = 'trial-signup-retention';

export type TrialSignupRetentionSummary = { purged: number };

type Queryable = { query: EntityManager['query'] };

/**
 * Deletes trial sign-ups that have had no use for `days` days.
 *
 * Abandoned: never activated, and COALESCE(last_email_sent_at, created_at)
 * is past the delay (last_email_sent_at is the last sign-up for that slug).
 * Left by a deleted workspace: activated, no
 * live tenant still holds the slug, and the latest `deleted_at` of the tenants
 * renamed `deleted-<slug>-<digits>` (or `activated_at`, when none exists) is
 * past the delay. A live workspace, including a frozen one, is left as it is.
 *
 * `trial_signups` and `tenants` have no row-level security. One statement: a
 * bare DELETE through `query()` returns `[rows, count]`, so the count comes
 * from the SELECT around the DELETE. The slug match is a prefix of a fixed
 * length, so `_` and `%` in a slug stay literal, and `deleted-ab-123-<digits>`
 * (slug `ab-123`) does not match slug `ab`.
 */
export async function purgeTrialSignups(db: Queryable, days = TRIAL_SIGNUP_RETENTION_DAYS): Promise<number> {
  const rows: Array<{ n: number }> = await db.query(
    `WITH gone AS (
       DELETE FROM trial_signups AS s
        WHERE (
          s.activated_at IS NULL
          AND COALESCE(s.last_email_sent_at, s.created_at) < now() - make_interval(days => $1::int)
        ) OR (
          s.activated_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM tenants t
             WHERE t.slug = s.slug AND t.deleted_at IS NULL
          )
          AND COALESCE(
            (
              SELECT max(t.deleted_at)
                FROM tenants t
               WHERE t.deleted_at IS NOT NULL
                 AND left(t.slug::text, length('deleted-' || s.slug::text || '-'))
                     = 'deleted-' || s.slug::text || '-'
                 AND substr(t.slug::text, length('deleted-' || s.slug::text || '-') + 1) ~ '^[0-9]+$'
            ),
            s.activated_at
          ) < now() - make_interval(days => $1::int)
        )
       RETURNING 1
     )
     SELECT count(*)::int AS n FROM gone`,
    [days],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Daily, multi-tenant only: sign-ups do not exist on a single-tenant
 * installation, so the task is not registered there. One run, one API process
 * (ScheduledTasksService). Deleting a workspace still removes its sign-up at
 * once; this task is the net for a delete that failed and for a sign-up that
 * was never activated.
 */
@Injectable()
export class TrialSignupRetentionService implements OnModuleInit {
  private readonly logger = new Logger(TrialSignupRetentionService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly scheduledTasks: ScheduledTasksService,
  ) {}

  onModuleInit() {
    if (Features.SINGLE_TENANT) return;
    this.scheduledTasks.register({
      name: TRIAL_SIGNUP_RETENTION_TASK_NAME,
      description: `Deletes trial sign-ups with no use for more than ${TRIAL_SIGNUP_RETENTION_DAYS} days`,
      defaultCron: '50 3 * * *',
      handler: () => this.run(),
    });
  }

  /** `manager`: the caller's transaction instead (specs). `days`: the delay, 90 outside specs. */
  async run(opts?: { manager?: EntityManager; days?: number }): Promise<TrialSignupRetentionSummary> {
    const days = opts?.days ?? TRIAL_SIGNUP_RETENTION_DAYS;
    const purged = await purgeTrialSignups(opts?.manager ?? this.dataSource, days);
    if (purged > 0) {
      this.logger.log(`[${TRIAL_SIGNUP_RETENTION_TASK_NAME}] ${purged} sign-up(s) purged`);
    }
    return { purged };
  }
}
