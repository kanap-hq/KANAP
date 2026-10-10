import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as dayjs from 'dayjs';
import 'dayjs/locale/de';
import 'dayjs/locale/es';
import 'dayjs/locale/fr';
import * as utc from 'dayjs/plugin/utc';
import * as timezone from 'dayjs/plugin/timezone';
import { EmailService } from '../email/email.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationsService } from './notifications.service';
import { buildWeeklyReviewEmail } from './notification-templates';
import { APP_URL_NOT_CONFIGURED_MESSAGE, resolveConfiguredAppBaseUrl, resolveNotificationBaseUrl } from '../common/url';
import { ACTIVE_TASK_STATUSES } from '../tasks/task.entity';
import { StorageService } from '../common/storage/storage.service';
import { type EmailBranding, resolveEmailBranding, getDefaultEmailBranding } from '../email/email-branding';
import { ScheduledTasksService } from '../admin/scheduled-tasks/scheduled-tasks.service';
import { resolveEmailLocale } from '../i18n/email-i18n';
import { calendarDaysUntil, isExpiryReminderDay, utcDateYmd } from './expiry-reminder-schedule';
import { assertScopeNatures, natureAnd, type BudgetNature } from '../spend/budget-nature';

dayjs.extend(utc);
dayjs.extend(timezone);

// Budget items warned on their end of validity. Table and column names come only from here.
// `nature`: each pass warns the lines of its own nature only (`spend/budget-nature.ts`), so a
// line is never warned twice: both natures share `spend_items` since lot Z1.
const BUDGET_ITEM_TABLES: Record<'opex' | 'capex', { table: string; name: string; nature?: BudgetNature }> = {
  opex: { table: 'spend_items', name: 'product_name', nature: 'opex' },
  capex: { table: 'spend_items', name: 'product_name', nature: 'capex' },
};
assertScopeNatures('scheduled-notifications', BUDGET_ITEM_TABLES, (t) => t.table);

@Injectable()
export class ScheduledNotificationsService implements OnModuleInit {
  private readonly logger = new Logger(ScheduledNotificationsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly emailService: EmailService,
    private readonly preferencesService: NotificationPreferencesService,
    private readonly notificationsService: NotificationsService,
    private readonly storage: StorageService,
    private readonly scheduledTasks: ScheduledTasksService,
  ) {}

  onModuleInit() {
    this.logger.log('ScheduledNotificationsService initialized');
    this.logger.log(`Current server time: ${dayjs().format('YYYY-MM-DD HH:mm:ss')} UTC`);

    this.scheduledTasks.register({
      name: 'check-expirations',
      description: 'Sends expiration warnings for contracts, OPEX and CAPEX items nearing their end date',
      defaultCron: '0 8 * * *',
      handler: () => this.checkExpirations(),
    });

    this.scheduledTasks.register({
      name: 'send-weekly-reviews',
      description: 'Sends weekly review digest emails to opted-in users at their preferred schedule',
      defaultCron: '0 * * * *',
      handler: () => this.sendWeeklyReviews(),
    });
  }

  // Cache for tenant slugs (tenantId -> slug)
  private tenantSlugCache = new Map<string, string>();

  /**
   * Get the tenant-specific base URL (e.g. https://acme.dev.kanap.net).
   * Falls back to the raw APP_URL if the slug cannot be resolved.
   */
  private async getTenantAppUrl(tenantId: string): Promise<string> {
    try {
      let slug = this.tenantSlugCache.get(tenantId);
      if (!slug) {
        const result = await this.dataSource.query(
          `SELECT slug FROM tenants WHERE id = $1`,
          [tenantId],
        );
        const slugFromDb: string | undefined = result[0]?.slug ?? undefined;
        if (slugFromDb) {
          slug = slugFromDb;
          this.tenantSlugCache.set(tenantId, slug);
        }
      }
      return resolveNotificationBaseUrl(slug ?? null);
    } catch (error) {
      this.logger.warn(`Failed to get tenant slug for ${tenantId}: ${error}`);
    }

    return resolveNotificationBaseUrl(null);
  }

  /**
   * The emails of a run link to the application: without a configured address the run sends
   * nothing and says so in one log line (and in its summary), the rest of the process goes on.
   */
  private skipWithoutAppUrl(label: string, summary: Record<string, any>): boolean {
    if (resolveConfiguredAppBaseUrl(null) !== null) return false;
    this.logger.warn(`[${label}] Skipped: ${APP_URL_NOT_CONFIGURED_MESSAGE}`);
    summary.skipped_reason = 'application URL is not configured';
    return true;
  }

  private async resolveBranding(tenantId: string): Promise<EmailBranding> {
    try {
      const rows = await this.dataSource.query(
        `SELECT branding FROM tenants WHERE id = $1`,
        [tenantId],
      );
      const raw = rows[0]?.branding;
      return await resolveEmailBranding(raw, this.storage);
    } catch (error) {
      this.logger.warn(`Failed to resolve email branding for tenant ${tenantId}: ${error}`);
      return getDefaultEmailBranding();
    }
  }

  // ============================================
  // EXPIRATION WARNINGS - Daily at 8 AM UTC
  // ============================================

  /**
   * Warns owners when a deadline is 30, 14, 7 or 1 calendar day(s) away (UTC dates, see
   * expiry-reminder-schedule.ts). `now` is the run's clock; the scheduler uses the real time.
   */
  async checkExpirations(now: Date = new Date()): Promise<Record<string, any>> {
    this.logger.log('[Expirations] Running expiration warnings check...');

    const summary: Record<string, any> = { tenantsProcessed: 0, contractWarnings: 0, opexWarnings: 0, capexWarnings: 0, errors: [] as string[] };
    if (this.skipWithoutAppUrl('Expirations', summary)) return summary;

    const tenants = await this.dataSource.query(`
      SELECT id, slug FROM tenants WHERE status = 'active'
    `);

    this.logger.log(`[Expirations] Processing ${tenants.length} active tenants`);

    for (const tenant of tenants) {
      const runner = this.dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();

      try {
        await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);

        const contractCount = await this.checkContractExpirationsForTenant(runner.manager, tenant.id, now);
        const opexCount = await this.checkOpexExpirationsForTenant(runner.manager, tenant.id, now);
        const capexCount = await this.checkCapexExpirationsForTenant(runner.manager, tenant.id, now);

        summary.contractWarnings += contractCount;
        summary.opexWarnings += opexCount;
        summary.capexWarnings += capexCount;
        summary.tenantsProcessed++;

        await runner.commitTransaction();
      } catch (error: any) {
        await runner.rollbackTransaction().catch(() => {});
        summary.errors.push(`Tenant ${tenant.slug ?? tenant.id}: ${error.message}`);
        this.logger.warn(`[Expirations] Failed for tenant ${tenant.id}: ${error}`);
      } finally {
        await runner.release();
      }
    }

    if (summary.errors.length > 0 && summary.tenantsProcessed === 0) {
      throw new Error(`All tenants failed: ${summary.errors[0]}`);
    }

    this.logger.log(
      `[Expirations] Complete: ${summary.contractWarnings} contracts, ${summary.opexWarnings} OPEX items, ${summary.capexWarnings} CAPEX items processed`,
    );

    return summary;
  }

  private async checkContractExpirationsForTenant(mg: any, tenantId: string, now: Date = new Date()): Promise<number> {
    // Candidates: contracts whose end date or cancellation deadline falls within 30 days.
    // End date = start_date + duration_months - 1 day; deadline = end date - notice period.
    // Both dates come back as YYYY-MM-DD text, free of any time zone conversion.
    const contracts = await mg.query(`
      SELECT
        c.id,
        c.name,
        c.tenant_id,
        c.owner_user_id,
        c.start_date,
        c.duration_months,
        c.notice_period_months,
        to_char(c.start_date + (c.duration_months || ' months')::interval - '1 day'::interval, 'YYYY-MM-DD') as end_date,
        to_char((c.start_date + (c.duration_months || ' months')::interval - '1 day'::interval) - (c.notice_period_months || ' months')::interval, 'YYYY-MM-DD') as cancellation_deadline,
        u.id as owner_id,
        u.email as owner_email,
        u.locale as owner_locale
      FROM contracts c
      LEFT JOIN users u ON u.id = c.owner_user_id AND u.tenant_id = c.tenant_id AND u.status = 'enabled'
      WHERE c.tenant_id = $1
        -- Active as the contract lists define it: no end of validity, or a future one.
        AND (c.disabled_at IS NULL OR c.disabled_at > now())
        AND c.owner_user_id IS NOT NULL
        AND (
          -- End date within 30 days
          (c.start_date + (c.duration_months || ' months')::interval - '1 day'::interval)::date
            BETWEEN $2::date AND $2::date + 30
          OR
          -- Cancellation deadline within 30 days
          ((c.start_date + (c.duration_months || ' months')::interval - '1 day'::interval) - (c.notice_period_months || ' months')::interval)::date
            BETWEEN $2::date AND $2::date + 30
        )
    `, [tenantId, utcDateYmd(now)]);

    for (const contract of contracts) {
      if (!contract.owner_email) continue;

      // The cancellation deadline and the end date each follow the schedule on their own.
      const deadlines: Array<['cancellation_deadline' | 'expiration', string | null]> = [
        ['cancellation_deadline', contract.cancellation_deadline],
        ['expiration', contract.end_date],
      ];
      for (const [warningType, deadline] of deadlines) {
        if (!deadline) continue;
        const daysRemaining = calendarDaysUntil(deadline, now);
        if (!isExpiryReminderDay(daysRemaining)) continue;
        await this.notificationsService.notifyExpirationWarning({
          itemType: 'contract',
          itemId: contract.id,
          itemName: contract.name,
          expirationDate: deadline,
          daysRemaining,
          warningType,
          recipients: [{ userId: contract.owner_id, email: contract.owner_email, locale: contract.owner_locale }],
          tenantId: contract.tenant_id,
          manager: mg,
        });
      }
    }

    return contracts.length;
  }

  private checkOpexExpirationsForTenant(mg: any, tenantId: string, now: Date = new Date()): Promise<number> {
    return this.checkBudgetItemExpirationsForTenant(mg, tenantId, 'opex', now);
  }

  private checkCapexExpirationsForTenant(mg: any, tenantId: string, now: Date = new Date()): Promise<number> {
    return this.checkBudgetItemExpirationsForTenant(mg, tenantId, 'capex', now);
  }

  private async checkBudgetItemExpirationsForTenant(
    mg: any,
    tenantId: string,
    itemType: 'opex' | 'capex',
    now: Date,
  ): Promise<number> {
    const t = BUDGET_ITEM_TABLES[itemType];
    // Candidates: items whose end of validity falls within 30 calendar days (UTC dates,
    // so that an end 30 days away at any time of day is included). A future disabled_at
    // means the item is still enabled, so no status predicate.
    const items = await mg.query(`
      SELECT
        s.id,
        s.${t.name} AS item_name,
        s.tenant_id,
        s.disabled_at,
        s.owner_it_id,
        s.owner_business_id,
        it_user.id as it_owner_id,
        it_user.email as it_owner_email,
        it_user.locale as it_owner_locale,
        biz_user.id as biz_owner_id,
        biz_user.email as biz_owner_email,
        biz_user.locale as biz_owner_locale
      FROM ${t.table} s
      LEFT JOIN users it_user ON it_user.id = s.owner_it_id AND it_user.tenant_id = s.tenant_id AND it_user.status = 'enabled'
      LEFT JOIN users biz_user ON biz_user.id = s.owner_business_id AND biz_user.tenant_id = s.tenant_id AND biz_user.status = 'enabled'
      WHERE s.tenant_id = $1${natureAnd('s', t.nature)}
        AND s.disabled_at IS NOT NULL
        AND (s.disabled_at AT TIME ZONE 'UTC')::date BETWEEN $2::date AND $2::date + 30
        AND (s.owner_it_id IS NOT NULL OR s.owner_business_id IS NOT NULL)
    `, [tenantId, utcDateYmd(now)]);

    for (const item of items) {
      // The last service day is the UTC calendar day of the end of validity.
      const expirationDate = dayjs.utc(item.disabled_at).format('YYYY-MM-DD');
      const daysRemaining = calendarDaysUntil(expirationDate, now);
      if (!isExpiryReminderDay(daysRemaining)) continue;

      const recipients = [];
      if (item.it_owner_email) {
        recipients.push({ userId: item.it_owner_id, email: item.it_owner_email, locale: item.it_owner_locale });
      }
      if (item.biz_owner_email) {
        recipients.push({ userId: item.biz_owner_id, email: item.biz_owner_email, locale: item.biz_owner_locale });
      }

      if (recipients.length > 0) {
        await this.notificationsService.notifyExpirationWarning({
          itemType,
          itemId: item.id,
          itemName: item.item_name,
          expirationDate,
          daysRemaining,
          warningType: 'expiration',
          recipients,
          tenantId: item.tenant_id,
          manager: mg,
        });
      }
    }

    return items.length;
  }

  private getCurrentWeekScheduledSlot(
    userNow: dayjs.Dayjs,
    weeklyReviewDay: number,
    weeklyReviewHour: number,
  ): dayjs.Dayjs {
    return userNow
      .startOf('day')
      .subtract(userNow.day(), 'day')
      .add(weeklyReviewDay, 'day')
      .hour(weeklyReviewHour)
      .minute(0)
      .second(0)
      .millisecond(0);
  }

  private getMostRecentScheduledSlot(
    userNow: dayjs.Dayjs,
    weeklyReviewDay: number,
    weeklyReviewHour: number,
  ): dayjs.Dayjs {
    const scheduledThisWeek = this.getCurrentWeekScheduledSlot(userNow, weeklyReviewDay, weeklyReviewHour);
    if (userNow.isBefore(scheduledThisWeek)) {
      return scheduledThisWeek.subtract(7, 'day');
    }
    return scheduledThisWeek;
  }

  private getNextScheduledSlot(
    userNow: dayjs.Dayjs,
    weeklyReviewDay: number,
    weeklyReviewHour: number,
  ): dayjs.Dayjs {
    const scheduledThisWeek = this.getCurrentWeekScheduledSlot(userNow, weeklyReviewDay, weeklyReviewHour);
    if (userNow.isBefore(scheduledThisWeek)) {
      return scheduledThisWeek;
    }
    return scheduledThisWeek.add(7, 'day');
  }

  private evaluateWeeklyReviewSchedule(
    now: dayjs.Dayjs,
    user: {
      timezone: string;
      weekly_review_day: number;
      weekly_review_hour: number;
      weekly_review_last_sent_at?: string | null;
      preferences_updated_at?: string | null;
    },
  ): { shouldSend: boolean; userNow: dayjs.Dayjs; dueAt: dayjs.Dayjs; reason: string } {
    const userNow = now.tz(user.timezone);
    const dueAt = this.getMostRecentScheduledSlot(
      userNow,
      user.weekly_review_day,
      user.weekly_review_hour,
    );

    const lastSentAt = user.weekly_review_last_sent_at
      ? dayjs(user.weekly_review_last_sent_at).tz(user.timezone)
      : null;
    if (lastSentAt && (lastSentAt.isAfter(dueAt) || lastSentAt.isSame(dueAt))) {
      return { shouldSend: false, userNow, dueAt, reason: 'already_sent_for_slot' };
    }

    const prefsUpdatedAt = user.preferences_updated_at
      ? dayjs(user.preferences_updated_at).tz(user.timezone)
      : null;
    if (!lastSentAt && prefsUpdatedAt && prefsUpdatedAt.isAfter(dueAt)) {
      return { shouldSend: false, userNow, dueAt, reason: 'schedule_updated_after_due_slot' };
    }

    return { shouldSend: true, userNow, dueAt, reason: 'due' };
  }

  private async markWeeklyReviewSent(mg: any, userId: string, tenantId: string): Promise<void> {
    await mg.query(
      `UPDATE user_notification_preferences
       SET weekly_review_last_sent_at = now()
       WHERE user_id = $1 AND tenant_id = $2`,
      [userId, tenantId],
    );
  }

  // ============================================
  // WEEKLY REVIEW - Every hour at minute 0
  // ============================================

  async sendWeeklyReviews(): Promise<Record<string, any>> {
    const now = dayjs();
    this.logger.log(
      `[WeeklyReview] Cron triggered at ${now.format('YYYY-MM-DD HH:mm:ss')} UTC`,
    );

    const summary: Record<string, any> = { tenantsProcessed: 0, totalUsers: 0, sent: 0, skipped: 0, errors: [] as string[] };
    if (this.skipWithoutAppUrl('WeeklyReview', summary)) return summary;

    const tenants = await this.dataSource.query(`
      SELECT id, slug FROM tenants WHERE status = 'active'
    `);

    this.logger.log(`[WeeklyReview] Processing ${tenants.length} active tenants`);

    for (const tenant of tenants) {
      const runner = this.dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();

      try {
        await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);

        const users = await runner.query(`
          SELECT
            u.id as user_id,
            u.tenant_id,
            COALESCE(p.weekly_review_day, 1) as weekly_review_day,
            COALESCE(p.weekly_review_hour, 8) as weekly_review_hour,
            COALESCE(p.timezone, 'Europe/Paris') as timezone,
            p.weekly_review_last_sent_at,
            p.updated_at as preferences_updated_at,
            u.email,
            u.first_name,
            u.last_name,
            u.locale
          FROM users u
          JOIN roles ro ON ro.id = u.role_id
          LEFT JOIN user_notification_preferences p
            ON p.user_id = u.id AND p.tenant_id = u.tenant_id
          WHERE u.status = 'enabled'
            AND (ro.is_system = false OR LOWER(ro.role_name) = 'administrator')
            AND COALESCE(p.weekly_review_enabled, false) = true
            AND COALESCE(p.emails_enabled, false) = true
        `);

        summary.totalUsers += users.length;
        this.logger.log(`[WeeklyReview] Tenant ${tenant.id}: ${users.length} eligible users`);

        for (const user of users) {
          try {
            const schedule = this.evaluateWeeklyReviewSchedule(now, user);
            if (schedule.shouldSend) {
              this.logger.log(
                `[WeeklyReview] Sending to ${user.email} (tz=${user.timezone}, local=${schedule.userNow.format('ddd HH:mm')}, due=${schedule.dueAt.format('ddd HH:mm')})`,
              );
              const sent = await this.sendWeeklyReviewForUser(user, runner.manager);
              if (sent) {
                await this.markWeeklyReviewSent(runner.manager, user.user_id, user.tenant_id);
                summary.sent++;
              } else {
                summary.skipped++;
              }
            } else {
              summary.skipped++;
              if (summary.skipped <= 3) {
                this.logger.debug(
                  `[WeeklyReview] Skipped ${user.email}: reason=${schedule.reason}, local=${schedule.userNow.format('ddd HH:mm')}, due=${schedule.dueAt.format('ddd HH:mm')}, wants day=${user.weekly_review_day} hour=${user.weekly_review_hour}`,
                );
              }
            }
          } catch (tzError: any) {
            this.logger.warn(`[WeeklyReview] Failed for ${user.user_id}: ${tzError}`);
          }
        }

        await runner.commitTransaction();
        summary.tenantsProcessed++;
      } catch (error: any) {
        await runner.rollbackTransaction().catch(() => {});
        summary.errors.push(`Tenant ${tenant.slug ?? tenant.id}: ${error.message}`);
        this.logger.warn(`[WeeklyReview] Failed for tenant ${tenant.id}: ${error}`);
      } finally {
        await runner.release();
      }
    }

    if (summary.errors.length > 0 && summary.tenantsProcessed === 0) {
      throw new Error(`All tenants failed: ${summary.errors[0]}`);
    }

    this.logger.log(
      `[WeeklyReview] Complete: ${summary.totalUsers} users found, sent=${summary.sent}, skipped=${summary.skipped}`,
    );

    return summary;
  }

  /**
   * Send a test weekly review email to the current user.
   * Used to verify the email pipeline works.
   */
  async sendTestWeeklyReview(
    userId: string,
    tenantId: string,
  ): Promise<{ success: boolean; message: string; code?: string }> {
    // The email links to the application: without a configured address the caller gets 400.
    if (resolveConfiguredAppBaseUrl(null) === null) {
      throw new BadRequestException(APP_URL_NOT_CONFIGURED_MESSAGE);
    }
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    try {
      // Set tenant context for RLS
      await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

      // Get user data with the same role + preference gates used by scheduler.
      const users = await runner.query(
        `SELECT
          u.id as user_id,
          u.tenant_id,
          u.email,
          u.first_name,
          u.last_name,
          u.locale,
          COALESCE(p.weekly_review_enabled, false) as weekly_review_enabled,
          COALESCE(p.emails_enabled, false) as emails_enabled,
          COALESCE(p.weekly_review_day, 1) as weekly_review_day,
          COALESCE(p.weekly_review_hour, 8) as weekly_review_hour,
          COALESCE(p.timezone, 'Europe/Paris') as timezone,
          p.weekly_review_last_sent_at,
          p.updated_at as preferences_updated_at,
          ro.is_system as role_is_system,
          ro.role_name
        FROM users u
        JOIN roles ro ON ro.id = u.role_id
        LEFT JOIN user_notification_preferences p ON p.user_id = u.id AND p.tenant_id = u.tenant_id
        WHERE u.id = $1
          AND u.tenant_id = $2
          AND u.status = 'enabled'`,
        [userId, tenantId],
      );

      if (users.length === 0) {
        await runner.rollbackTransaction();
        return { success: false, code: 'WEEKLY_REVIEW_USER_NOT_FOUND', message: 'User not found or disabled' };
      }

      const user = users[0];
      const roleName = String(user.role_name ?? '').toLowerCase();
      const roleEligible = user.role_is_system === false || roleName === 'administrator';
      if (!roleEligible) {
        await runner.rollbackTransaction();
        return {
          success: false,
          code: 'WEEKLY_REVIEW_ROLE_INELIGIBLE',
          message: 'Weekly review is unavailable for your current role.',
        };
      }

      if (!user.emails_enabled || !user.weekly_review_enabled) {
        await runner.rollbackTransaction();
        return {
          success: false,
          code: 'WEEKLY_REVIEW_NOT_ENABLED',
          message: 'Enable both "Email Notifications" and "Weekly Review Email" to preview scheduled weekly reviews.',
        };
      }

      this.logger.log(`Sending test weekly review to ${user.email}...`);

      const sent = await this.sendWeeklyReviewForUser(user, runner.manager);
      if (!sent) {
        await runner.rollbackTransaction();
        return { success: false, code: 'WEEKLY_REVIEW_SEND_FAILED', message: `Failed to send weekly review to ${user.email}` };
      }

      const userNow = dayjs().tz(user.timezone);
      const nextScheduled = this.getNextScheduledSlot(
        userNow,
        user.weekly_review_day,
        user.weekly_review_hour,
      );
      await runner.commitTransaction();
      return {
        success: true,
        message:
          `Weekly review sent to ${user.email}. ` +
          `Next scheduled run: ${nextScheduled.format('ddd YYYY-MM-DD HH:mm')} (${user.timezone}).`,
      };
    } catch (error) {
      await runner.rollbackTransaction().catch(() => {});
      this.logger.error(`Failed to send test weekly review: ${error}`);
      return { success: false, message: `Failed: ${error}` };
    } finally {
      await runner.release();
    }
  }

  private async sendWeeklyReviewForUser(
    user: {
      user_id: string;
      tenant_id: string;
      email: string;
      first_name: string;
      last_name: string;
      timezone: string;
      locale?: string | null;
    },
    mg: any,
  ): Promise<boolean> {
    const userId = user.user_id;
    const tenantId = user.tenant_id;

    // Calculate week boundaries in user's timezone
    const userNow = dayjs().tz(user.timezone);
    const weekStart = userNow.subtract(7, 'day').startOf('day').utc().toISOString();
    const weekEnd = userNow.startOf('day').utc().toISOString();
    const emailLocale = resolveEmailLocale(user.locale);
    const weekLabel = `${dayjs(weekStart).locale(emailLocale).format('MMMM D')} - ${dayjs(weekEnd).subtract(1, 'day').locale(emailLocale).format('MMMM D, YYYY')}`;

    // Set tenant context for RLS
    await mg.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

    // Query 1: Tasks I closed last week
    const tasksClosed = await mg.query(
      `SELECT t.id, t.title
       FROM tasks t
       WHERE t.tenant_id = $1
         AND t.status = 'done'
         AND t.updated_at >= $2
         AND t.updated_at < $3
         AND (
           t.assignee_user_id = $4
           OR t.creator_id = $4
           OR t.owner_ids @> to_jsonb($4::text)
         )
       ORDER BY t.updated_at DESC
       LIMIT 20`,
      [tenantId, weekStart, weekEnd, userId],
    );

    // Query 2: My projects with status changes
    const projectsWithChanges = await mg.query(
      `SELECT DISTINCT ON (p.id) p.id, p.name, p.status,
              al.before_json->>'status' as "oldStatus"
       FROM portfolio_projects p
       JOIN audit_log al ON al.record_id = p.id
         AND al.table_name = 'portfolio_projects'
         AND al.action = 'update'
         AND al.before_json->>'status' IS DISTINCT FROM al.after_json->>'status'
         AND al.created_at >= $2
         AND al.created_at < $3
       WHERE p.tenant_id = $1
         AND (
           p.business_lead_id = $4
           OR p.it_lead_id = $4
           OR p.business_sponsor_id = $4
           OR p.it_sponsor_id = $4
           OR EXISTS (
             SELECT 1 FROM portfolio_project_team pt
             WHERE pt.project_id = p.id AND pt.user_id = $4
           )
         )
       ORDER BY p.id, al.created_at DESC`,
      [tenantId, weekStart, weekEnd, userId],
    );

    // Query 3: Tasks closed on my projects (excluding my own tasks)
    const tasksClosedOnProjects = await mg.query(
      `SELECT t.id, t.title, p.name as "projectName"
       FROM tasks t
       JOIN portfolio_projects p ON t.related_object_id = p.id
         AND t.related_object_type = 'project'
       WHERE t.tenant_id = $1
         AND t.status = 'done'
         AND t.updated_at >= $2
         AND t.updated_at < $3
         AND (
           p.business_lead_id = $4
           OR p.it_lead_id = $4
           OR p.business_sponsor_id = $4
           OR p.it_sponsor_id = $4
           OR EXISTS (
             SELECT 1 FROM portfolio_project_team pt
             WHERE pt.project_id = p.id AND pt.user_id = $4
           )
         )
         AND NOT (
           t.assignee_user_id = $4
           OR t.creator_id = $4
           OR t.owner_ids @> to_jsonb($4::text)
         )
       ORDER BY t.updated_at DESC
       LIMIT 20`,
      [tenantId, weekStart, weekEnd, userId],
    );

    // Query 4: Top priority tasks
    const topTasks = await mg.query(
      `SELECT t.id, t.title, t.due_date as "dueDate", t.priority_level as priority
       FROM tasks t
       WHERE t.tenant_id = $1
         AND t.status = ANY($3)
         AND (
           t.assignee_user_id = $2
           OR t.creator_id = $2
           OR t.owner_ids @> to_jsonb($2::text)
         )
       ORDER BY
         CASE t.priority_level
           WHEN 'blocker' THEN 1
           WHEN 'high' THEN 2
           WHEN 'normal' THEN 3
           WHEN 'low' THEN 4
           WHEN 'optional' THEN 5
         END,
         t.due_date NULLS LAST
       LIMIT 10`,
      [tenantId, userId, ACTIVE_TASK_STATUSES],
    );

    // Query 5: Top priority projects as lead
    const topProjectsAsLead = await mg.query(
      `SELECT p.id, p.name, p.status
       FROM portfolio_projects p
       WHERE p.tenant_id = $1
         AND p.status IN ('planned', 'in_progress', 'in_testing')
         AND (p.business_lead_id = $2 OR p.it_lead_id = $2)
       ORDER BY
         COALESCE(p.priority_score, 0) DESC,
         p.planned_end NULLS LAST
       LIMIT 5`,
      [tenantId, userId],
    );

    // Query 6: Top priority projects as contributor
    const topProjectsAsContributor = await mg.query(
      `SELECT p.id, p.name, p.status
       FROM portfolio_projects p
       WHERE p.tenant_id = $1
         AND p.status IN ('planned', 'in_progress', 'in_testing')
         AND (
           p.business_sponsor_id = $2
           OR p.it_sponsor_id = $2
           OR EXISTS (
             SELECT 1 FROM portfolio_project_team pt
             WHERE pt.project_id = p.id AND pt.user_id = $2
           )
         )
         AND p.business_lead_id IS DISTINCT FROM $2
         AND p.it_lead_id IS DISTINCT FROM $2
       ORDER BY
         COALESCE(p.priority_score, 0) DESC,
         p.planned_end NULLS LAST
       LIMIT 5`,
      [tenantId, userId],
    );

    // Query 7: New requests where the user is involved (team member, lead, or sponsor)
    const newRequests = await mg.query(
      `SELECT r.id, r.name
       FROM portfolio_requests r
       WHERE r.tenant_id = $1
         AND r.created_at >= $3
         AND r.created_at < $4
         AND (
           r.business_lead_id = $2
           OR r.it_lead_id = $2
           OR r.business_sponsor_id = $2
           OR r.it_sponsor_id = $2
           OR EXISTS (
             SELECT 1 FROM portfolio_request_team rt
             WHERE rt.request_id = r.id AND rt.user_id = $2
           )
         )
       ORDER BY r.created_at DESC
       LIMIT 10`,
      [tenantId, userId, weekStart, weekEnd],
    );

    // Build and send email
    const userName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'there';
    const branding = await this.resolveBranding(tenantId);

    const content = buildWeeklyReviewEmail({
      userName,
      weekLabel,
      appUrl: await this.getTenantAppUrl(tenantId),
      tasksClosed: tasksClosed.map((t: any) => ({ id: t.id, title: t.title })),
      projectsWithChanges: projectsWithChanges.map((p: any) => ({
        id: p.id,
        name: p.name,
        oldStatus: p.oldStatus || 'unknown',
        newStatus: p.status,
      })),
      tasksClosedOnProjects: tasksClosedOnProjects.map((t: any) => ({
        id: t.id,
        title: t.title,
        projectName: t.projectName,
      })),
      topTasks: topTasks.map((t: any) => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        dueDate: t.dueDate ? dayjs(t.dueDate).format('YYYY-MM-DD') : undefined,
      })),
      topProjectsAsLead: topProjectsAsLead.map((p: any) => ({
        id: p.id,
        name: p.name,
        status: p.status,
      })),
      topProjectsAsContributor: topProjectsAsContributor.map((p: any) => ({
        id: p.id,
        name: p.name,
        status: p.status,
      })),
      newRequests: newRequests.map((r: any) => ({
        id: r.id,
        name: r.name,
      })),
      branding,
      locale: emailLocale,
    });

    try {
      await this.emailService.send({
        to: user.email,
        subject: content.subject,
        html: content.html,
        text: content.text,
        attachments: content.attachments,
      });
      return true;
    } catch (error) {
      this.logger.error(`Failed to send weekly review to ${user.email}: ${error}`);
      return false;
    }
  }
}
