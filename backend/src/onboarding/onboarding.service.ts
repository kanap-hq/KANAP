import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { tenantSeedLanguage } from '../analytics/recommended-dimensions.seed';
import { writeAuditLog } from '../audit/audit.service';
import { Features } from '../config/features';
import {
  countCreatedSinceLoad,
  DemoDataService,
  DemoDataState,
  DemoErrorCode,
  DemoStatus,
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
 * before the choice is written: `own_data` chosen by an administrator hides the sample data
 * banner and empties the workspace (stops a running load, resets loaded sample data, asking for
 * `confirm_reset` when objects were created since the load, no reset e-mail); a member's
 * `own_data` changes nothing, and is refused while sample data is there. `example` loads the
 * sample data into an empty workspace when an administrator chooses it. A refused `own_data`
 * writes nothing; a refused load still writes the choice.
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
  sample_data: { status: DemoStatus; step: string | null; error_code: DemoErrorCode | null };
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
      sample_data: { status: demo.status, step: demo.step, error_code: demo.status === 'failed' ? demo.error_code : null },
      reset_in_progress: demo.status === 'resetting' || (demo.status === 'loading' && !!demo.cancel_requested_at),
    };
  }

  /**
   * `PUT /onboarding/choice` with `{ angle?, mode?, confirm_reset? }`. A field left out keeps its
   * value. Any user may set a field still empty; changing a field already set takes an
   * administrator. The tenant's row is locked, so two first answers at the same time apply one
   * after the other. A new mode acts on the sample data first (`applyMode`); `confirm_reset:
   * true` lets `own_data` erase objects created since the sample data load (409
   * `sample_data_modified` otherwise). `host` is the request's Host header, which a load of the
   * sample data needs.
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
    if (has(input, 'confirm_reset') && typeof input.confirm_reset !== 'boolean') {
      throw new BadRequestException({ code: 'invalid_confirm_reset', message: 'confirm_reset must be true or false.' });
    }
    const confirmReset = input.confirm_reset === true;

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
      ? await this.applyMode(manager, tenantId, userId, mode!, { host: opts.host ?? '', confirmReset })
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
   * The sample data calls work on their own connections, committed at once. This request's
   * transaction holds the tenant's onboarding row and possibly a key-share lock on the tenant
   * row (the first insert into `tenant_onboarding`), which the writes of the sample data state
   * do not wait for; it never writes the tenant row itself, so a stop or a reset started here
   * waits for no lock of this request (the reset's lock on the tenant row waits for its commit).
   */
  private async applyMode(
    manager: EntityManager,
    tenantId: string,
    userId: string,
    mode: OnboardingMode,
    opts: { host: string; confirmReset: boolean },
  ): Promise<{ emptying: boolean }> {
    if (Features.SINGLE_TENANT || (await this.demo.isSystemTenant(tenantId))) return { emptying: false };
    if (mode === 'own_data') return this.emptyWorkspace(manager, tenantId, userId, opts.confirmReset);
    await this.loadExample(manager, tenantId, userId, opts.host);
    return { emptying: false };
  }

  /**
   * `own_data`. A member's choice changes nothing (sample data, banner, load at activation still
   * waiting), and is refused (403 `administrator_required`, even for the workspace's first
   * choice) while sample data is there: loaded, loading, or left by a failed reset.
   *
   * An administrator's choice first hides the sample data banner (unless the data is loaded),
   * through the pool: a load at activation still waiting for its slot can no longer claim it.
   * Then, by status: a running load is stopped then reset, and ends `idle`; loaded sample data is
   * reset, after `confirm_reset` when objects were created since the load (409
   * `sample_data_modified` with their number, nothing written otherwise); `failed` after a
   * failed reset is reset again; any other `failed` was reset when it failed and goes back to
   * `idle` with no reset; `idle` and `resetting`: nothing to erase. No reset e-mail.
   */
  private async emptyWorkspace(
    manager: EntityManager,
    tenantId: string,
    userId: string,
    confirmReset: boolean,
  ): Promise<{ emptying: boolean }> {
    if (!(await isTenantAdministrator(manager, tenantId, userId))) {
      const { status, error_code } = await this.demo.getStatus(tenantId);
      if (status === 'loaded' || status === 'loading' || (status === 'failed' && error_code === 'reset_failed')) {
        throw new ForbiddenException({
          code: 'administrator_required',
          message: 'Only an administrator of this workspace can do this.',
        });
      }
      return { emptying: false };
    }

    const first = await this.demo.hideBannerUnlessLoaded(tenantId);
    let state: DemoDataState = first.state;
    if (state.status === 'loading') {
      const stop = await this.demo.cancelLoad(tenantId, userId);
      if (stop.requested) return { emptying: true };
      // The load ended before the stop was written: the rules of its new status apply.
      state = stop.state;
    }
    if (state.status === 'loaded') {
      if (!confirmReset && state.loaded_at) {
        const created = await countCreatedSinceLoad(manager, tenantId, state.loaded_at);
        if (created > 0) {
          throw new ConflictException({
            statusCode: 409,
            code: 'sample_data_modified',
            created_since_load: created,
            message: 'Objects were created since the sample data was loaded. Confirm to erase them too.',
          });
        }
      }
      return this.resetSampleData(tenantId, userId);
    }
    if (state.status === 'failed' && state.error_code === 'reset_failed') return this.resetSampleData(tenantId, userId);
    if (state.status === 'failed') await this.demo.clearFailedLoad(tenantId, userId);
    if (!first.hidden) await this.demo.hideBannerUnlessLoaded(tenantId);
    return { emptying: false };
  }

  /** The reset of `own_data`: no e-mail, the banner hidden in the same write. */
  private async resetSampleData(tenantId: string, userId: string): Promise<{ emptying: boolean }> {
    try {
      await this.demo.startReset({ tenantId, actorId: userId, notify: false, dismissBanner: true });
      return { emptying: true };
    } catch (error) {
      // Reset by someone else meanwhile (over, or still running): nothing left to erase.
      if (!isStatusConflictIn(error, ['idle', 'resetting'])) throw error;
    }
    await this.demo.hideBannerUnlessLoaded(tenantId);
    return { emptying: false };
  }

  /**
   * `example`: an administrator's choice loads the sample data into an empty workspace (`idle`,
   * or `failed` once its reset is done), in the tenant's seed language, from the request's host.
   * A refusal (workspace not empty, subscription, too many loads at once, ...) leaves the choice
   * to be written, with a warning in the server log. Another user's choice loads nothing.
   */
  private async loadExample(manager: EntityManager, tenantId: string, userId: string, host: string): Promise<void> {
    const state = await this.demo.getStatus(tenantId);
    const empty = state.status === 'idle' || (state.status === 'failed' && state.error_code !== 'reset_failed');
    if (!empty || !(await isTenantAdministrator(manager, tenantId, userId))) return;
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
