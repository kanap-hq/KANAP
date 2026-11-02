import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { withTenant } from '../../common/tenant-runner';
import { AUTH_EVENT_TABLE } from '../../audit/security-events';
import { RECORD_HISTORY } from '../../audit/record-history.inventory';
import { DiscoveryCall, DISCOVERY_CALL_AUDIT_TABLE, DiscoveryCallService } from '../../discovery-call/discovery-call.service';
import { isOnboardingAngle, isOnboardingMode, ONBOARDING_PATHS } from '../../onboarding/onboarding-paths';
import { TENANT_RESET_AUDIT_SOURCE_REF } from '../tenants/tenant-reset.service';
import {
  FunnelWeek,
  isTrialState,
  needsAttention,
  ownActivityCutoff,
  stepsDone,
  TrialState,
  trialState,
  TrialSubscription,
  weeklyFunnel,
} from './trial-funnel';

export type TrialFunnelRow = {
  signup_id: string;
  tenant_id: string | null;
  slug: string;
  name: string;
  contact_name: string | null;
  state: TrialState;
  /** No sign-in NO_SIGN_IN_ALERT_HOURS after the activation of a running trial. */
  needs_attention: boolean;
  created_at: string;
  activated_at: string | null;
  first_sign_in_at: string | null;
  last_sign_in_at: string | null;
  angle: string | null;
  mode: string | null;
  steps_done: number | null;
  steps_total: number | null;
  sample_data_loaded_at: string | null;
  first_record_at: string | null;
  first_plaid_question_at: string | null;
  first_import_at: string | null;
  first_invitation_at: string | null;
  back_after_1_day_at: string | null;
  back_after_7_days_at: string | null;
  trial_end: string | null;
  converted_at: string | null;
  discovery_call_first_click: { at: string; placement: string | null } | null;
  discovery_call: DiscoveryCall | null;
};

export type TrialFunnel = { items: TrialFunnelRow[]; weeks: FunnelWeek[]; attention: number };

type SignupRow = {
  signup_id: string;
  slug: string;
  org_name: string;
  first_name: string | null;
  last_name: string | null;
  created_at: Date;
  activated_at: Date | null;
  tenant_id: string | null;
  demo: Record<string, unknown> | null;
};

type Milestones = {
  first_sign_in_at: Date | null;
  last_sign_in_at: Date | null;
  back_after_1_day_at: Date | null;
  back_after_7_days_at: Date | null;
  first_record_at: Date | null;
  first_import_at: Date | null;
  first_invitation_at: Date | null;
  first_plaid_question_at: Date | null;
  converted_at: Date | null;
  first_click_at: Date | null;
  first_click_placement: string | null;
};

const SIGN_IN_ACTIONS = ['login', 'sso_login'];
/** The audit labels of the records (the history inventory): what a "record" is. */
const RECORD_LABELS = [...new Set(Object.values(RECORD_HISTORY).flatMap((entry) => entry.auditLabels))];
/** Workspaces read at once: each holds a connection for its transaction. */
const CONCURRENCY = 4;

const iso = (value: Date | string | null | undefined): string | null =>
  (value === null || value === undefined ? null : (value instanceof Date ? value : new Date(value)).toISOString());

/**
 * The trial funnel: one row per trial sign-up (`trial_signups`), its workspace's milestones read
 * from the audit log and the tables that already hold them, never from tracking of its own.
 * `trial_signups` and `tenants` carry no tenant policy; each workspace is read in its own tenant
 * transaction, every query naming `tenant_id`.
 */
@Injectable()
export class AdminTrialsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly discoveryCall: DiscoveryCallService,
  ) {}

  async list(query: { state?: unknown } = {}, now: Date = new Date()): Promise<TrialFunnel> {
    const signups: SignupRow[] = await this.dataSource.query(
      `SELECT s.id AS signup_id, s.slug, s.org_name, s.first_name, s.last_name, s.created_at, s.activated_at,
              t.id AS tenant_id, t.metadata->'demo' AS demo
         FROM trial_signups s
         LEFT JOIN tenants t ON t.slug = s.slug AND t.deleted_at IS NULL
          AND t.is_system_tenant IS NOT TRUE AND t.status NOT IN ('deleting', 'deleted')
        ORDER BY s.created_at DESC, s.id`,
    );

    const rows: TrialFunnelRow[] = new Array(signups.length);
    let next = 0;
    const worker = async () => {
      while (next < signups.length) {
        const index = next++;
        rows[index] = await this.buildRow(signups[index], now);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, signups.length) }, worker));

    const weeks = weeklyFunnel(rows, now);
    const attention = rows.filter((row) => row.needs_attention).length;
    const state = isTrialState(query.state) ? query.state : null;
    const items = rows
      .filter((row) => !state || row.state === state)
      // The workspaces to look at first, then the most recent sign-ups.
      .sort((a, b) => Number(b.needs_attention) - Number(a.needs_attention) || b.created_at.localeCompare(a.created_at));
    return { items, weeks, attention };
  }

  /** The discovery call of a trial workspace, set by hand (`DiscoveryCallService.saveManual`). */
  async saveDiscoveryCall(tenantId: string, body: unknown, actorId: string | null): Promise<DiscoveryCall> {
    await this.findTrialTenantOrFail(tenantId);
    return withTenant(this.dataSource, tenantId, (manager) => this.discoveryCall.saveManual(manager, tenantId, body, actorId));
  }

  async removeDiscoveryCall(tenantId: string, actorId: string | null): Promise<void> {
    await this.findTrialTenantOrFail(tenantId);
    await withTenant(this.dataSource, tenantId, (manager) => this.discoveryCall.remove(manager, tenantId, actorId));
  }

  private async findTrialTenantOrFail(tenantId: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new BadRequestException('Invalid tenant id');
    const [row]: Array<{ id: string }> = await this.dataSource.query(
      `SELECT t.id FROM tenants t JOIN trial_signups s ON s.slug = t.slug
        WHERE t.id = $1 AND t.deleted_at IS NULL AND t.is_system_tenant IS NOT TRUE`,
      [tenantId],
    );
    if (!row) throw new NotFoundException('Trial workspace not found');
  }

  private async buildRow(signup: SignupRow, now: Date): Promise<TrialFunnelRow> {
    const contactName = [signup.first_name, signup.last_name].map((part) => (part ?? '').trim()).filter(Boolean).join(' ') || null;
    const base: TrialFunnelRow = {
      signup_id: signup.signup_id,
      tenant_id: signup.tenant_id,
      slug: signup.slug,
      name: signup.org_name,
      contact_name: contactName,
      state: 'awaiting_activation',
      needs_attention: false,
      created_at: iso(signup.created_at)!,
      activated_at: iso(signup.activated_at),
      first_sign_in_at: null,
      last_sign_in_at: null,
      angle: null,
      mode: null,
      steps_done: null,
      steps_total: null,
      sample_data_loaded_at: null,
      first_record_at: null,
      first_plaid_question_at: null,
      first_import_at: null,
      first_invitation_at: null,
      back_after_1_day_at: null,
      back_after_7_days_at: null,
      trial_end: null,
      converted_at: null,
      discovery_call_first_click: null,
      discovery_call: null,
    };
    const tenantId = signup.tenant_id;
    if (!tenantId) return base;

    return withTenant(this.dataSource, tenantId, async (manager) => {
      const [subscription]: TrialSubscription[] = await manager.query(
        `SELECT status, plan_name, trial_end, stripe_subscription_id FROM subscriptions
          WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`,
        [tenantId],
      );
      const [reset]: Array<{ at: Date | null }> = await manager.query(
        `SELECT max(created_at) AS at FROM audit_log
          WHERE tenant_id = $1 AND table_name = 'tenants_admin' AND source_ref = $2`,
        [tenantId, TENANT_RESET_AUDIT_SOURCE_REF],
      );
      const cutoff = ownActivityCutoff({ activated_at: signup.activated_at, sample_data: signup.demo, last_reset_at: reset?.at ?? null, now });
      const milestones = await this.readMilestones(manager, tenantId, cutoff);
      const onboarding = await this.readOnboarding(manager, tenantId);
      const call = await this.discoveryCall.read(manager, tenantId);

      const state = trialState({ activated_at: signup.activated_at, has_tenant: true, subscription: subscription ?? null, now });
      const everLoaded = signup.demo?.ever_loaded_at;
      return {
        ...base,
        state,
        needs_attention: needsAttention({ state, activated_at: signup.activated_at, first_sign_in_at: milestones.first_sign_in_at, now }),
        first_sign_in_at: iso(milestones.first_sign_in_at),
        last_sign_in_at: iso(milestones.last_sign_in_at),
        ...onboarding,
        sample_data_loaded_at: typeof everLoaded === 'string' ? iso(everLoaded) : null,
        first_record_at: iso(milestones.first_record_at),
        first_plaid_question_at: iso(milestones.first_plaid_question_at),
        first_import_at: iso(milestones.first_import_at),
        first_invitation_at: iso(milestones.first_invitation_at),
        back_after_1_day_at: iso(milestones.back_after_1_day_at),
        back_after_7_days_at: iso(milestones.back_after_7_days_at),
        trial_end: iso(subscription?.trial_end ?? null),
        converted_at: iso(milestones.converted_at),
        discovery_call_first_click: milestones.first_click_at
          ? { at: iso(milestones.first_click_at)!, placement: milestones.first_click_placement }
          : null,
        discovery_call: call,
      };
    });
  }

  /**
   * One statement, in the tenant transaction:
   * - sign-ins: the `auth` events `login` and `sso_login`; the last one is also the latest
   *   `users.last_login_at`; back after one or seven days: a sign-in, or anything written in a
   *   person's name (audit row, question to Plaid), that long after the first sign-in (a session
   *   lasts several days without a new sign-in); a visit that writes nothing leaves no trace;
   * - first record: a creation in the person's name (not `system` nor `webhook`) of a record the
   *   history knows, after `cutoff`; first import: a row written by the budget file or another
   *   import source (`source` naming `import`), after `cutoff`; CSV imports of most families write
   *   no audit row and do not show;
   * - first invitation: a user whose audit row says `invited`;
   * - first question to Plaid: the first `user` message of a conversation;
   * - conversion: the first audit row of the subscription linked to Stripe;
   * - discovery call: the first `trial.discovery_call_clicked` and its placement.
   */
  private async readMilestones(manager: EntityManager, tenantId: string, cutoff: Date | null): Promise<Milestones> {
    const [row]: Milestones[] = await manager.query(
      `WITH sign_ins AS (
         SELECT created_at FROM audit_log
          WHERE tenant_id = $1 AND table_name = $2 AND action = ANY($3::text[])
       ), first_sign_in AS (SELECT min(created_at) AS at FROM sign_ins),
       activity AS (
         SELECT created_at FROM sign_ins
         UNION ALL
         SELECT created_at FROM audit_log
          WHERE tenant_id = $1 AND user_id IS NOT NULL AND coalesce(source, 'user') NOT IN ('system', 'webhook')
         UNION ALL
         SELECT created_at FROM ai_messages WHERE tenant_id = $1 AND role = 'user'
       ),
       first_click AS (
         SELECT created_at, after_json->>'placement' AS placement FROM audit_log
          WHERE tenant_id = $1 AND table_name = $6 AND action = 'trial.discovery_call_clicked'
          ORDER BY created_at LIMIT 1
       )
       SELECT
         f.at AS first_sign_in_at,
         GREATEST((SELECT max(created_at) FROM sign_ins), (SELECT max(last_login_at) FROM users WHERE tenant_id = $1)) AS last_sign_in_at,
         (SELECT min(created_at) FROM activity WHERE created_at >= f.at + interval '1 day') AS back_after_1_day_at,
         (SELECT min(created_at) FROM activity WHERE created_at >= f.at + interval '7 days') AS back_after_7_days_at,
         (SELECT min(created_at) FROM audit_log
           WHERE tenant_id = $1 AND action = 'create' AND table_name = ANY($4::text[]) AND user_id IS NOT NULL
             AND coalesce(source, 'user') NOT IN ('system', 'webhook') AND created_at > $5) AS first_record_at,
         (SELECT min(created_at) FROM audit_log
           WHERE tenant_id = $1 AND user_id IS NOT NULL
             AND (source = 'budget_file' OR source ~ '(^|_)import($|_)') AND created_at > $5) AS first_import_at,
         (SELECT min(created_at) FROM audit_log
           WHERE tenant_id = $1 AND table_name = 'users' AND user_id IS NOT NULL
             AND after_json->>'status' = 'invited') AS first_invitation_at,
         (SELECT min(created_at) FROM ai_messages WHERE tenant_id = $1 AND role = 'user') AS first_plaid_question_at,
         (SELECT min(created_at) FROM audit_log
           WHERE tenant_id = $1 AND table_name = 'subscriptions'
             AND coalesce(after_json->>'stripe_subscription_id', '') <> '') AS converted_at,
         (SELECT created_at FROM first_click) AS first_click_at,
         (SELECT placement FROM first_click) AS first_click_placement
       FROM first_sign_in f`,
      [tenantId, AUTH_EVENT_TABLE, SIGN_IN_ACTIONS, RECORD_LABELS, cutoff ?? new Date(0), DISCOVERY_CALL_AUDIT_TABLE],
    );
    return row;
  }

  /** Angle and mode of the workspace (`tenant_onboarding`) and the steps done on that path. */
  private async readOnboarding(manager: EntityManager, tenantId: string) {
    const [choice]: Array<{ angle: string | null; mode: string | null }> = await manager.query(
      `SELECT angle, mode FROM tenant_onboarding WHERE tenant_id = $1`,
      [tenantId],
    );
    const angle = choice?.angle ?? null;
    const mode = choice?.mode ?? null;
    if (!isOnboardingAngle(angle) || !isOnboardingMode(mode)) {
      return { angle, mode, steps_done: null, steps_total: null };
    }
    const path = ONBOARDING_PATHS[angle][mode];
    const done: Array<{ keys: string[] }> = await manager.query(
      `SELECT array_agg(step_key) AS keys FROM onboarding_steps
        WHERE tenant_id = $1 AND angle = $2 AND mode = $3 GROUP BY user_id`,
      [tenantId, angle, mode],
    );
    return { angle, mode, steps_done: stepsDone(path, done.map((row) => row.keys ?? [])), steps_total: path.length };
  }
}
