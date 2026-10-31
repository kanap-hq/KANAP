import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { tenantSeedLanguage } from '../analytics/recommended-dimensions.seed';
import { writeAuditLog } from '../audit/audit.service';
import { Features } from '../config/features';
import {
  DemoDataService,
  DemoDataState,
  DemoStatus,
  markSampleDataBannerDismissed,
  readDemoState,
} from '../demo-data/demo-data.service';
import {
  isOnboardingAngle,
  isOnboardingMode,
  OnboardingAngle,
  OnboardingMode,
  onboardingPath,
} from './onboarding-paths';
import { isTenantAdministrator } from './tenant-administrator';

/**
 * The onboarding of a workspace (`doc/onboarding.md`): the angle and the mode the workspace
 * chose at its first opening (`tenant_onboarding`, one row per tenant), and each user's progress
 * through the five steps of that path (`onboarding_steps`) and whether they hid the list
 * (`onboarding_dismissals`).
 *
 * Every method runs on the request's manager (its transaction carries the tenant) and names
 * `tenant_id` in each query. Every route answers with the state after the operation, for the
 * calling user (`OnboardingState`).
 *
 * Audit log, read by the platform measures (no other form): `table_name = 'onboarding'`,
 * `record_id` = the tenant, actions `onboarding.angle_chosen` `{ angle, previous }`,
 * `onboarding.mode_chosen` `{ mode, previous }`, `onboarding.step_done`
 * `{ angle, mode, step_key }` and `onboarding.completed` `{ angle, mode }` (once per user, angle
 * and mode). Nothing for a step undone or for the list hidden.
 *
 * A new mode acts on the sample data (`DemoDataService`, cloud only, never on a system tenant),
 * before the choice is written: `own_data` empties the workspace (stops a running load, resets
 * a loaded or failed one, administrators only, no reset e-mail) and hides the sample data
 * banner; `example` loads the sample data into an empty workspace when an administrator chooses
 * it. A refused `own_data` writes nothing; a refused load still writes the choice.
 */

export const ONBOARDING_AUDIT_TABLE = 'onboarding';

export type OnboardingStep = { key: string; done_at: string | null };

export type OnboardingState = {
  angle: OnboardingAngle | null;
  mode: OnboardingMode | null;
  chosen_at: string | null;
  /**
   * True while the angle or the mode is missing (anybody may set the missing field), and always
   * for an administrator (who may also change a field already set).
   */
  can_choose: boolean;
  /** The five steps of the current path, in order; empty without an angle or a mode. */
  steps: OnboardingStep[];
  /** The first step not done; null when all are done or there is no path. */
  next_step: string | null;
  completed: boolean;
  dismissed_at: string | null;
  /** The sample data state (`tenants.metadata.demo`): status and step only. */
  sample_data: { status: DemoStatus; step: string | null };
  /** The workspace is being emptied: a reset runs, or a load is stopping before its reset. */
  reset_in_progress: boolean;
};

type ChoiceRow = { angle: OnboardingAngle | null; mode: OnboardingMode | null; chosen_at: Date | string | null };

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

const has = (body: object, key: string) => Object.prototype.hasOwnProperty.call(body, key);

/** The `code` of an HTTP exception's answer, or the error message when it has none. */
function errorCode(error: unknown): string {
  const response = (error as { getResponse?: () => unknown })?.getResponse?.();
  const code = response && typeof response === 'object' ? (response as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : error instanceof Error ? error.message : String(error);
}

/** A 409 of the sample data whose status, read when it was refused, is one of `statuses`. */
function isStatusConflictIn(error: unknown, statuses: readonly DemoStatus[]): boolean {
  const response = (error as { getResponse?: () => unknown })?.getResponse?.() as { code?: unknown; status?: unknown } | undefined;
  return response?.code === 'demo_status_conflict' && statuses.includes(response.status as DemoStatus);
}

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(private readonly demo: DemoDataService) {}

  /** The state of the workspace's onboarding for `userId`. */
  async getState(manager: EntityManager, tenantId: string, userId: string): Promise<OnboardingState> {
    const choice = await this.readChoice(manager, tenantId);
    const angle = choice?.angle ?? null;
    const mode = choice?.mode ?? null;
    const path = onboardingPath(angle, mode);

    const doneByKey = new Map<string, string | null>();
    if (path.length > 0) {
      const rows: Array<{ step_key: string; done_at: Date | string }> = await manager.query(
        `SELECT step_key, done_at FROM onboarding_steps
          WHERE tenant_id = $1 AND user_id = $2 AND angle = $3 AND mode = $4`,
        [tenantId, userId, angle, mode],
      );
      for (const row of rows) doneByKey.set(row.step_key, iso(row.done_at));
    }
    const steps = path.map((key) => ({ key, done_at: doneByKey.get(key) ?? null }));
    const next = steps.find((step) => !step.done_at);

    const [dismissal]: Array<{ dismissed_at: Date | string }> = await manager.query(
      `SELECT dismissed_at FROM onboarding_dismissals WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, userId],
    );
    const [tenant]: Array<{ demo: unknown }> = await manager.query(
      `SELECT metadata->'demo' AS demo FROM tenants WHERE id = $1`,
      [tenantId],
    );
    const demo = readDemoState(tenant?.demo);

    return {
      angle,
      mode,
      chosen_at: iso(choice?.chosen_at),
      can_choose: !angle || !mode || (await isTenantAdministrator(manager, tenantId, userId)),
      steps,
      next_step: next?.key ?? null,
      completed: steps.length > 0 && !next,
      dismissed_at: iso(dismissal?.dismissed_at),
      sample_data: { status: demo.status, step: demo.step },
      reset_in_progress: demo.status === 'resetting' || (demo.status === 'loading' && !!demo.cancel_requested_at),
    };
  }

  /**
   * `PUT /onboarding/choice` with `{ angle?, mode? }`. A field left out keeps its value. Any user
   * may set a field still empty; changing a field already set takes an administrator. The
   * tenant's row is locked, so two first answers at the same time apply one after the other.
   * A new mode acts on the sample data first (`applyMode`); `host` is the request's Host header,
   * which a load of the sample data needs.
   */
  async setChoice(
    manager: EntityManager,
    tenantId: string,
    userId: string,
    body: unknown,
    opts: { host?: string } = {},
  ): Promise<OnboardingState> {
    const input = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
    const hasAngle = has(input, 'angle');
    const hasMode = has(input, 'mode');
    if (!hasAngle && !hasMode) {
      throw new BadRequestException({ code: 'choice_required', message: 'Give an angle, a mode, or both.' });
    }
    if (hasAngle && !isOnboardingAngle(input.angle)) {
      throw new BadRequestException({ code: 'invalid_angle', message: 'The angle must be budget, cartography or portfolio.' });
    }
    if (hasMode && !isOnboardingMode(input.mode)) {
      throw new BadRequestException({ code: 'invalid_mode', message: 'The mode must be example or own_data.' });
    }

    await manager.query(
      `INSERT INTO tenant_onboarding (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId],
    );
    const [current]: ChoiceRow[] = await manager.query(
      `SELECT angle, mode, chosen_at FROM tenant_onboarding WHERE tenant_id = $1 FOR UPDATE`,
      [tenantId],
    );
    const previousAngle = current?.angle ?? null;
    const previousMode = current?.mode ?? null;
    const angle = hasAngle ? (input.angle as OnboardingAngle) : previousAngle;
    const mode = hasMode ? (input.mode as OnboardingMode) : previousMode;
    const angleChanges = angle !== previousAngle;
    const modeChanges = mode !== previousMode;

    if ((angleChanges && previousAngle) || (modeChanges && previousMode)) {
      if (!(await isTenantAdministrator(manager, tenantId, userId))) {
        throw new ForbiddenException({
          code: 'administrator_required',
          message: 'Only an administrator of this workspace can change this choice.',
        });
      }
    }
    if (!angleChanges && !modeChanges) return this.getState(manager, tenantId, userId);

    // Before the write: a refused effect writes nothing.
    const effect = modeChanges
      ? await this.applyMode(manager, tenantId, userId, mode!, opts.host ?? '')
      : { emptying: false };

    await manager.query(
      `INSERT INTO tenant_onboarding (tenant_id, angle, mode, chosen_at, chosen_by, updated_at)
       VALUES ($1, $2, $3, now(), $4, now())
       ON CONFLICT (tenant_id) DO UPDATE
         SET angle = EXCLUDED.angle, mode = EXCLUDED.mode, chosen_at = now(),
             chosen_by = EXCLUDED.chosen_by, updated_at = now()`,
      [tenantId, angle, mode, userId],
    );
    if (angleChanges) {
      await this.audit(manager, tenantId, userId, 'onboarding.angle_chosen', { angle, previous: previousAngle });
    }
    if (modeChanges) {
      await this.audit(manager, tenantId, userId, 'onboarding.mode_chosen', { mode, previous: previousMode });
    }
    const state = await this.getState(manager, tenantId, userId);
    // A reset started here may be over already; the answer still says it was started.
    return effect.emptying ? { ...state, reset_in_progress: true } : state;
  }

  /**
   * What a new mode does to the sample data, before the choice is written. Nothing on-premise
   * (no sample data there) or on a system tenant. `emptying`: a reset, or the stop of a load
   * followed by a reset, was started.
   *
   * The sample data calls work on their own connections, while this request's transaction holds
   * the tenant's onboarding row and possibly a key-share lock on the tenant row (from the first
   * insert into `tenant_onboarding`). So every write on the tenant row through those connections
   * happens before a reset can start (the reset locks the tenant row and would wait for this
   * transaction), and the banner of an idle workspace is hidden through the request's manager.
   */
  private async applyMode(
    manager: EntityManager,
    tenantId: string,
    userId: string,
    mode: OnboardingMode,
    host: string,
  ): Promise<{ emptying: boolean }> {
    if (Features.SINGLE_TENANT || (await this.demo.isSystemTenant(tenantId))) return { emptying: false };
    if (mode === 'own_data') return this.emptyWorkspace(manager, tenantId, userId);
    await this.loadExample(manager, tenantId, userId, host);
    return { emptying: false };
  }

  /**
   * `own_data`: a running load is stopped then reset, loaded or failed sample data is reset; both
   * take an administrator (403 `administrator_required`), even for the workspace's first choice,
   * and send no reset e-mail. Idle, or already resetting: nothing to erase. In every case the
   * sample data banner is hidden.
   */
  private async emptyWorkspace(manager: EntityManager, tenantId: string, userId: string): Promise<{ emptying: boolean }> {
    // getStatus takes over a load or a reset left by a stopped API process.
    let state: DemoDataState = await this.demo.getStatus(tenantId);
    if (state.status === 'loading') {
      state = await this.demo.cancelLoad(tenantId, userId, { dismissBanner: true });
      if (state.status === 'loading') return { emptying: true };
      // The load ended before the stop was written: `loaded` or `failed` are reset below.
    }
    if (state.status === 'loaded' || state.status === 'failed') {
      try {
        await this.demo.startReset({ tenantId, actorId: userId, notify: false, dismissBanner: true });
        return { emptying: true };
      } catch (error) {
        // Reset by someone else meanwhile (over, or still running): nothing left to erase.
        if (!isStatusConflictIn(error, ['idle', 'resetting'])) throw error;
      }
    }
    await markSampleDataBannerDismissed(manager, tenantId);
    return { emptying: false };
  }

  /**
   * `example`: an administrator's choice loads the sample data into an idle workspace, in the
   * tenant's seed language, from the request's host. A refusal (workspace not empty,
   * subscription, too many loads at once, ...) leaves the choice to be written, with a warning
   * in the server log. Another user's choice loads nothing.
   */
  private async loadExample(manager: EntityManager, tenantId: string, userId: string, host: string): Promise<void> {
    const state = await this.demo.getStatus(tenantId);
    if (state.status !== 'idle' || !(await isTenantAdministrator(manager, tenantId, userId))) return;
    const [tenant]: Array<{ metadata: unknown }> = await manager.query(`SELECT metadata FROM tenants WHERE id = $1`, [tenantId]);
    try {
      await this.demo.loadDemoData(tenantId, { language: tenantSeedLanguage(tenant?.metadata), actorId: userId, host });
    } catch (error) {
      this.logger.warn(`Sample data not loaded into tenant ${tenantId} for the onboarding choice: ${errorCode(error)}`);
    }
  }

  /**
   * Marks a step of the current path done (`done`) or not done, for `userId`. A step already in
   * that state is left as it is. The user's own writes are serialized (a transaction lock on the
   * tenant and the user), so the step that completes the path is always seen as the last one.
   */
  async setStepDone(manager: EntityManager, tenantId: string, userId: string, key: string, done: boolean): Promise<OnboardingState> {
    const choice = await this.readChoice(manager, tenantId);
    const angle = choice?.angle ?? null;
    const mode = choice?.mode ?? null;
    if (!angle || !mode) {
      throw new ConflictException({ code: 'no_choice', message: 'Choose an angle and a mode first.' });
    }
    const path = onboardingPath(angle, mode);
    if (!path.includes(key)) {
      throw new BadRequestException({ code: 'unknown_step', message: 'This step is not part of the current path.' });
    }

    await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`, [`onboarding:${tenantId}:${userId}`]);
    if (!done) {
      await manager.query(
        `DELETE FROM onboarding_steps
          WHERE tenant_id = $1 AND user_id = $2 AND angle = $3 AND mode = $4 AND step_key = $5`,
        [tenantId, userId, angle, mode, key],
      );
      return this.getState(manager, tenantId, userId);
    }

    const inserted: unknown[] = await manager.query(
      `INSERT INTO onboarding_steps (tenant_id, user_id, angle, mode, step_key)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, user_id, angle, mode, step_key) DO NOTHING
       RETURNING 1`,
      [tenantId, userId, angle, mode, key],
    );
    if (inserted.length > 0) {
      await this.audit(manager, tenantId, userId, 'onboarding.step_done', { angle, mode, step_key: key });
      const [progress]: Array<{ done: number }> = await manager.query(
        `SELECT count(*)::int AS done FROM onboarding_steps
          WHERE tenant_id = $1 AND user_id = $2 AND angle = $3 AND mode = $4 AND step_key = ANY($5::text[])`,
        [tenantId, userId, angle, mode, [...path]],
      );
      // Only the step that completes the path looks for an earlier `onboarding.completed`.
      if (progress && progress.done === path.length) {
        const [previous]: Array<{ logged: boolean }> = await manager.query(
          `SELECT EXISTS (
             SELECT 1 FROM audit_log
              WHERE tenant_id = $1 AND record_id = $1 AND table_name = $5 AND action = 'onboarding.completed'
                AND user_id = $2 AND after_json->>'angle' = $3 AND after_json->>'mode' = $4
           ) AS logged`,
          [tenantId, userId, angle, mode, ONBOARDING_AUDIT_TABLE],
        );
        if (!previous?.logged) {
          await this.audit(manager, tenantId, userId, 'onboarding.completed', { angle, mode });
        }
      }
    }
    return this.getState(manager, tenantId, userId);
  }

  /** Hides (`dismissed`) or shows again the list of first steps, for `userId`. */
  async setDismissed(manager: EntityManager, tenantId: string, userId: string, dismissed: boolean): Promise<OnboardingState> {
    if (dismissed) {
      await manager.query(
        `INSERT INTO onboarding_dismissals (tenant_id, user_id) VALUES ($1, $2)
         ON CONFLICT (tenant_id, user_id) DO NOTHING`,
        [tenantId, userId],
      );
    } else {
      await manager.query(`DELETE FROM onboarding_dismissals WHERE tenant_id = $1 AND user_id = $2`, [tenantId, userId]);
    }
    return this.getState(manager, tenantId, userId);
  }

  private async readChoice(manager: EntityManager, tenantId: string): Promise<ChoiceRow | null> {
    const [row]: ChoiceRow[] = await manager.query(
      `SELECT angle, mode, chosen_at FROM tenant_onboarding WHERE tenant_id = $1`,
      [tenantId],
    );
    return row ?? null;
  }

  private async audit(manager: EntityManager, tenantId: string, userId: string, action: string, after: Record<string, unknown>) {
    await writeAuditLog(manager, {
      table: 'onboarding',
      recordId: tenantId,
      action,
      after,
      userId,
      source: 'user',
    });
  }
}
