import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Features } from '../../config/features';
import { COMPANY_NAME } from '../../config/product';
import { withTenant } from '../../common/tenant-runner';
import { NeverRejects } from '../../common/never-rejects';
import { APP_URL_NOT_CONFIGURED_MESSAGE, resolveConfiguredAppBaseUrl } from '../../common/url';
import { ScheduledTasksService } from '../../admin/scheduled-tasks/scheduled-tasks.service';
import { writeAuditLog } from '../../audit/audit.service';
import { tenantSeedLanguage } from '../../analytics/recommended-dimensions.seed';
import { discoveryCallConfig } from '../../discovery-call/discovery-call.config';
import { StripeConfigService } from '../../billing/stripe/stripe.config';
import { Subscription, SubscriptionStatus } from '../../billing/subscription.entity';
import { computeTrialDeletionAt } from '../../billing/subscription-freeze.util';
import {
  DISCOVERY_CALL_AUDIT_TABLE,
  DiscoveryCallService,
  discoveryCallBooked,
  type DiscoveryCallPlacement,
} from '../../discovery-call/discovery-call.service';
import type { EmailContent } from '../../notifications/notification-templates';
import { EmailService } from '../email.service';
import {
  TRIAL_MAIL_SENT_COLUMN,
  TRIAL_MAIL_MILESTONES,
  dueTrialMail,
  type TrialMailMilestone,
} from './trial-mail-schedule';
import {
  TRIAL_ANGLES,
  buildTrialEndedEmail,
  buildTrialEndingEmail,
  buildTrialFollowUpEmail,
  buildTrialThanksEmail,
  buildTrialWelcomeEmail,
  displayUrl,
  type TrialAngle,
  type TrialCallLink,
  type TrialMode,
} from './trial-mail-templates';
import { parseTrialMailLinkToken, sameLinkToken, trialMailLinkToken, trialMailLinkUrl } from './trial-mail-links';

/** Friedrich, who signs the trial e-mails, sends J+5 and gets the replies of the others. */
export const TRIAL_MAIL_FOUNDER_ADDRESS = 'fried@kanap.net';
export const TRIAL_MAIL_FOUNDER = `"Friedrich (${COMPANY_NAME})" <${TRIAL_MAIL_FOUNDER_ADDRESS}>`;
/** Workspaces whose trial started longer ago are no longer looked at (trial, then 30 days, then margin). */
const TRIAL_MAIL_HORIZON_DAYS = 90;
const DEFAULT_MARKETING_URL = 'https://www.kanap.net';

const CALL_PLACEMENT: Partial<Record<TrialMailMilestone, DiscoveryCallPlacement>> = { j0: 'mail_j0', j5: 'mail_j5' };

type TrialTenantRow = {
  id: string;
  slug: string;
  name: string;
  metadata: unknown;
  email: string;
  signup_first_name: string | null;
  activated_at: Date;
};

type StateRow = Record<string, Date | null>;

type SubscriptionRow = Pick<
  Subscription,
  'trial_end' | 'plan_name' | 'stripe_subscription_id' | 'latest_invoice_id' | 'current_period_end' | 'canceled_at'
> & { status: string | null };

type TenantFacts = {
  milestone: TrialMailMilestone;
  recipient: { email: string; firstName: string | null };
  angle: TrialAngle | null;
  mode: TrialMode | null;
  trialEnd: Date | null;
  deletionAt: Date | null;
  /** The secret of the e-mail's links (`trial_mails.link_token`). */
  linkToken: string;
};

/**
 * Enrols a new trial workspace in the trial e-mails: called in the transaction that activates
 * the trial. A workspace without a row (created before the trial e-mails shipped) gets none.
 */
export async function enrollTrialMails(manager: EntityManager, tenantId: string): Promise<void> {
  await manager.query(`INSERT INTO trial_mails (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`, [tenantId]);
}

export type TrialMailsRunSummary = {
  tenants: number;
  sent: Partial<Record<TrialMailMilestone, number>>;
  failed: number;
  skipped_reason?: string;
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The trial e-mails (`doc/trial-mails.md`): J0, J+5, J+12, the end-of-trial notice and the
 * thank-you at the first subscription, each sent at most once per workspace (`trial_mails`).
 * Cloud only. The task `send-trial-mails` runs every ten minutes; the Stripe webhook also runs
 * one workspace at once when its subscription changes, so the thank-you does not wait.
 *
 * What the e-mails read: the trial (subscription, dates), the path and the mode chosen
 * (`tenant_onboarding`), the discovery call (R1) and the sign-up person. Never what the person did
 * in the workspace.
 */
@Injectable()
export class TrialMailsService implements OnModuleInit {
  private readonly logger = new Logger(TrialMailsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly email: EmailService,
    private readonly scheduledTasks: ScheduledTasksService,
    private readonly discoveryCall: DiscoveryCallService,
    private readonly stripeConfig: StripeConfigService,
  ) {}

  onModuleInit() {
    if (Features.SINGLE_TENANT) return;
    this.scheduledTasks.register({
      name: 'send-trial-mails',
      description: 'Sends the trial e-mails (welcome, day 5, day 12, end of trial) and the thank-you at the first subscription',
      defaultCron: '*/10 * * * *',
      handler: () => this.run(),
    });
  }

  /** The trial lock and the deletion apply (`computeTrialDeletionAt`): cloud with Stripe configured. */
  private billingEnforced(): boolean {
    return !Features.SINGLE_TENANT && this.stripeConfig.isConfigured();
  }

  /** Why nothing can be sent now, or null. */
  private blockedReason(): string | null {
    if (Features.SINGLE_TENANT) return 'not available on-premise';
    if (this.email.transportName === 'disabled') return 'e-mail sending is off';
    if (resolveConfiguredAppBaseUrl(null) === null) return APP_URL_NOT_CONFIGURED_MESSAGE;
    return null;
  }

  /** One pass over the trial workspaces. `now` is the run's clock. Never rejects for one workspace. */
  async run(now: Date = new Date()): Promise<TrialMailsRunSummary> {
    const summary: TrialMailsRunSummary = { tenants: 0, sent: {}, failed: 0 };
    const blocked = this.blockedReason();
    if (blocked) {
      summary.skipped_reason = blocked;
      return summary;
    }
    for (const row of await this.trialTenants(null)) {
      summary.tenants += 1;
      const outcome = await this.sendDue(row, now);
      if (outcome === 'failed') summary.failed += 1;
      else if (outcome) summary.sent[outcome] = (summary.sent[outcome] ?? 0) + 1;
    }
    return summary;
  }

  /**
   * The Stripe webhook changed this workspace's subscription: send what is due now (the
   * thank-you). Fire-and-forget: never rejects, and is never given the webhook's transaction.
   */
  @NeverRejects()
  async onSubscriptionChanged(tenantId: string, now: Date = new Date()): Promise<void> {
    if (this.blockedReason()) return;
    const [row] = await this.trialTenants(tenantId);
    if (row) await this.sendDue(row, now);
  }

  /**
   * The trial workspaces: an activated trial sign-up (its person is the recipient), not deleted,
   * not a system tenant, active, started within the horizon. `tenants` and `trial_signups` carry
   * no tenant policy: one query without tenant context.
   */
  private async trialTenants(tenantId: string | null): Promise<TrialTenantRow[]> {
    return this.dataSource.query(
      `SELECT DISTINCT ON (t.id) t.id, t.slug, t.name, t.metadata, s.email,
              s.first_name AS signup_first_name, s.activated_at
         FROM tenants t
         JOIN trial_signups s ON s.slug = t.slug AND s.activated_at IS NOT NULL
        WHERE t.deleted_at IS NULL
          AND t.is_system_tenant IS NOT TRUE
          AND t.status = 'active'
          AND s.activated_at > now() - make_interval(days => $1::int)
          AND ($2::uuid IS NULL OR t.id = $2::uuid)
        ORDER BY t.id, s.activated_at DESC`,
      [TRIAL_MAIL_HORIZON_DAYS, tenantId],
    );
  }

  /** The mail due for this workspace, sent; its milestone, `failed`, or null when none is due. */
  private async sendDue(row: TrialTenantRow, now: Date): Promise<TrialMailMilestone | 'failed' | null> {
    let facts: TenantFacts | null;
    try {
      facts = await withTenant(this.dataSource, row.id, (manager) => this.readFacts(manager, row, now));
    } catch (error) {
      this.logger.warn(`Trial e-mails of tenant ${row.id} not checked: ${errorMessage(error)}`);
      return 'failed';
    }
    if (!facts) return null;

    const { milestone } = facts;
    const column = TRIAL_MAIL_SENT_COLUMN[milestone];
    // Stamped before the send, in its own transaction: two runs never send the same mail.
    const claimed = await withTenant(this.dataSource, row.id, async (manager) => {
      // A CTE: `manager.query` returns `[rows, count]` for a bare UPDATE.
      const rows: Array<{ at: Date }> = await manager.query(
        `WITH claimed AS (
           UPDATE trial_mails SET ${column} = $2, updated_at = now()
            WHERE tenant_id = $1 AND ${column} IS NULL
              AND ($3::boolean OR unsubscribed_at IS NULL)
           RETURNING ${column} AS at
         )
         SELECT at FROM claimed`,
        [row.id, now, milestone === 'thanks'],
      );
      return rows[0]?.at ?? null;
    }).catch((error) => {
      this.logger.warn(`Trial e-mail ${milestone} of tenant ${row.id} not stamped: ${errorMessage(error)}`);
      return 'failed' as const;
    });
    if (claimed === 'failed') return 'failed';
    if (!claimed) return null;

    try {
      await this.email.send(this.compose(row, facts));
      this.logger.log(`Trial e-mail ${milestone} sent for tenant ${row.id}`);
      return milestone;
    } catch (error) {
      // Not sent: the stamp is lifted, the next run tries again.
      await withTenant(this.dataSource, row.id, (manager) => manager.query(
        `UPDATE trial_mails SET ${column} = NULL, updated_at = now() WHERE tenant_id = $1 AND ${column} = $2`,
        [row.id, claimed],
      )).catch((releaseError) => this.logger.warn(`Trial e-mail ${milestone} of tenant ${row.id} stays stamped: ${errorMessage(releaseError)}`));
      this.logger.warn(`Trial e-mail ${milestone} for tenant ${row.id} not sent: ${errorMessage(error)}`);
      return 'failed';
    }
  }

  /**
   * Reads what the schedule needs, under the tenant. A workspace in trial gets its `trial_mails`
   * row here, and the first sign-in of its person is noted. A workspace never seen in trial (one
   * that subscribed before this scheduler existed) has no row and gets nothing.
   */
  private async readFacts(manager: EntityManager, row: TrialTenantRow, now: Date): Promise<TenantFacts | null> {
    const [subscription]: SubscriptionRow[] = await manager.query(
      `SELECT status::text AS status, trial_end, plan_name, stripe_subscription_id, latest_invoice_id, current_period_end, canceled_at
         FROM subscriptions WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [row.id],
    );
    if (!subscription) return null;
    const trialing = subscription.status === 'trialing';
    const [state]: StateRow[] = await manager.query(`SELECT * FROM trial_mails WHERE tenant_id = $1`, [row.id]);
    if (!state) return null;

    const [user]: Array<{ first_name: string | null; email: string; status: string; last_login_at: Date | null }> = await manager.query(
      `SELECT first_name, email, status, last_login_at FROM users WHERE tenant_id = $1 AND lower(email) = lower($2)`,
      [row.id, row.email],
    );
    let firstLoginAt = state.first_login_at;
    if (trialing && !firstLoginAt && user?.last_login_at) {
      firstLoginAt = user.last_login_at;
      await manager.query(
        `UPDATE trial_mails SET first_login_at = $2, updated_at = now() WHERE tenant_id = $1 AND first_login_at IS NULL`,
        [row.id, firstLoginAt],
      );
    }

    const [choice]: Array<{ angle: string | null; mode: string | null }> = await manager.query(
      `SELECT angle, mode FROM tenant_onboarding WHERE tenant_id = $1`,
      [row.id],
    );
    const angle = (TRIAL_ANGLES as readonly string[]).includes(choice?.angle ?? '') ? choice!.angle as TrialAngle : null;
    const mode = choice?.mode === 'example' || choice?.mode === 'own_data' ? choice.mode : null;

    const subscribed = subscription.status === 'active' && !!subscription.stripe_subscription_id;
    const deletionAt = computeTrialDeletionAt(subscription as SubscriptionRow & { status: SubscriptionStatus }, this.billingEnforced());
    const milestone = dueTrialMail({
      subscription: trialing ? 'trialing' : (subscribed ? 'subscribed' : 'other'),
      trialStart: new Date(row.activated_at),
      trialEnd: subscription.trial_end ? new Date(subscription.trial_end) : null,
      deletionAt,
      choiceMade: !!angle && !!mode,
      firstLoginAt: firstLoginAt ? new Date(firstLoginAt) : null,
      sent: new Set(TRIAL_MAIL_MILESTONES.filter((key) => state[TRIAL_MAIL_SENT_COLUMN[key]])),
      unsubscribed: !!state.unsubscribed_at,
      callBooked: discoveryCallBooked(await this.discoveryCall.read(manager, row.id)),
    }, now);
    // The person of the sign-up, still a user able to sign in.
    if (!milestone || !user || user.status !== 'enabled') return null;

    return {
      milestone,
      recipient: { email: user.email, firstName: user.first_name?.trim() || row.signup_first_name?.trim() || null },
      angle,
      mode,
      trialEnd: subscription.trial_end ? new Date(subscription.trial_end) : null,
      deletionAt,
      linkToken: state.link_token as unknown as string,
    };
  }

  /** The discovery call link of a mail, counted on the way (`/trial-mails/call`); null without a booking page or address. */
  private callLink(appUrl: string, token: string, milestone: TrialMailMilestone): TrialCallLink {
    const placement = CALL_PLACEMENT[milestone];
    const { url, fallbackEmail } = discoveryCallConfig();
    if (!placement || (!url && !fallbackEmail)) return null;
    return {
      url: trialMailLinkUrl(appUrl, 'call', token, { from: placement }),
      display: url ? displayUrl(url) : fallbackEmail,
    };
  }

  private compose(row: TrialTenantRow, facts: TenantFacts) {
    const appUrl = resolveConfiguredAppBaseUrl(row.slug)!;
    const common = {
      locale: tenantSeedLanguage(row.metadata),
      firstName: facts.recipient.firstName,
      workspace: row.name,
      appUrl,
    };
    const token = trialMailLinkToken(row.id, facts.linkToken);
    const unsubscribeUrl = trialMailLinkUrl(appUrl, 'unsubscribe', token);
    const call = this.callLink(appUrl, token, facts.milestone);
    let content: EmailContent;
    switch (facts.milestone) {
      case 'j0':
        content = buildTrialWelcomeEmail({ ...common, angle: facts.angle, mode: facts.mode, call, unsubscribeUrl });
        break;
      case 'j5':
        content = buildTrialFollowUpEmail({ ...common, angle: facts.angle, mode: facts.mode, call, unsubscribeUrl });
        break;
      case 'j12':
        content = buildTrialEndingEmail({ ...common, trialEnd: facts.trialEnd!, marketingUrl: marketingUrl(), unsubscribeUrl });
        break;
      case 'ended':
        content = buildTrialEndedEmail({ ...common, deletionDate: facts.deletionAt!, unsubscribeUrl });
        break;
      case 'thanks':
        content = buildTrialThanksEmail(common);
        break;
    }
    const trialSequence = facts.milestone !== 'thanks';
    return {
      to: facts.recipient.email,
      subject: content.subject,
      html: content.html,
      text: content.text,
      attachments: content.attachments,
      // J+5 is Friedrich's own note; the others leave from the application and come back to him.
      ...(facts.milestone === 'j5' ? { from: TRIAL_MAIL_FOUNDER } : { replyTo: TRIAL_MAIL_FOUNDER }),
      ...(trialSequence
        ? { headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }
        : {}),
    };
  }

  /**
   * The workspace a link token names, when its secret is the one stored in `trial_mails`; null
   * otherwise (a malformed token, an unknown or deleted workspace, another secret).
   */
  async linkTenant(token: unknown): Promise<string | null> {
    const parsed = parseTrialMailLinkToken(token);
    if (!parsed) return null;
    const [tenant] = await this.dataSource.query(`SELECT 1 FROM tenants WHERE id = $1 AND deleted_at IS NULL`, [parsed.tenantId]);
    if (!tenant) return null;
    const stored = await withTenant(this.dataSource, parsed.tenantId, async (manager) => {
      const [row]: Array<{ link_token: string }> = await manager.query(`SELECT link_token FROM trial_mails WHERE tenant_id = $1`, [parsed.tenantId]);
      return row?.link_token ?? null;
    });
    return sameLinkToken(parsed.linkToken, stored) ? parsed.tenantId : null;
  }

  /** Unsubscribes the workspace from the trial e-mails (the thank-you stays). Idempotent. */
  async unsubscribe(tenantId: string): Promise<void> {
    await withTenant(this.dataSource, tenantId, async (manager) => {
      const [{ changed }]: Array<{ changed: number }> = await manager.query(
        `WITH changed AS (
           UPDATE trial_mails SET unsubscribed_at = now(), updated_at = now()
            WHERE tenant_id = $1 AND unsubscribed_at IS NULL
           RETURNING 1)
         SELECT count(*)::int AS changed FROM changed`,
        [tenantId],
      );
      if (changed === 0) return;
      await writeAuditLog(manager, {
        table: DISCOVERY_CALL_AUDIT_TABLE,
        recordId: tenantId,
        action: 'trial.mails_unsubscribed',
        before: null,
        after: null,
        userId: null,
        source: 'system',
      });
    });
  }

  /** A click on a discovery call link of a mail: counted, never in the way of the redirect. */
  async recordCallClick(tenantId: string, placement: DiscoveryCallPlacement): Promise<void> {
    try {
      await withTenant(this.dataSource, tenantId, (manager) => this.discoveryCall.recordClick(manager, tenantId, null, placement));
    } catch (error) {
      this.logger.warn(`Discovery call click of tenant ${tenantId} not recorded: ${errorMessage(error)}`);
    }
  }

  /** The workspace's name and language, for the unsubscribe page; null for an unknown workspace. */
  async workspace(tenantId: string): Promise<{ name: string; locale: string } | null> {
    const [row]: Array<{ name: string; metadata: unknown }> = await this.dataSource.query(
      `SELECT name, metadata FROM tenants WHERE id = $1 AND deleted_at IS NULL`,
      [tenantId],
    );
    return row ? { name: row.name, locale: tenantSeedLanguage(row.metadata) } : null;
  }
}

function marketingUrl(): string {
  return (process.env.MARKETING_BASE_URL || DEFAULT_MARKETING_URL).trim().replace(/\/$/, '');
}
