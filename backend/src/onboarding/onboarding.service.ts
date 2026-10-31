import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { writeAuditLog } from '../audit/audit.service';
import { DemoStatus, readDemoState } from '../demo-data/demo-data.service';
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
 */

export const ONBOARDING_AUDIT_TABLE = 'onboarding';

export type OnboardingStep = { key: string; done_at: string | null };

export type OnboardingState = {
  angle: OnboardingAngle | null;
  mode: OnboardingMode | null;
  chosen_at: string | null;
  /** True while nothing is chosen, and always for an administrator. */
  can_choose: boolean;
  /** The five steps of the current path, in order; empty without an angle or a mode. */
  steps: OnboardingStep[];
  /** The first step not done; null when all are done or there is no path. */
  next_step: string | null;
  completed: boolean;
  dismissed_at: string | null;
  /** The sample data state (`tenants.metadata.demo`): status and step only. */
  sample_data: { status: DemoStatus; step: string | null };
  reset_in_progress: boolean;
};

/** A change of the workspace's choice, as `setChoice` applied it. */
export type OnboardingChoiceChange = {
  tenantId: string;
  userId: string;
  angle: { value: OnboardingAngle; previous: OnboardingAngle | null } | null;
  mode: { value: OnboardingMode; previous: OnboardingMode | null } | null;
};

type ChoiceRow = { angle: OnboardingAngle | null; mode: OnboardingMode | null; chosen_at: Date | string | null };

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

const has = (body: object, key: string) => Object.prototype.hasOwnProperty.call(body, key);

@Injectable()
export class OnboardingService {
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
      can_choose: (!angle && !mode) || (await isTenantAdministrator(manager, tenantId, userId)),
      steps,
      next_step: next?.key ?? null,
      completed: steps.length > 0 && !next,
      dismissed_at: iso(dismissal?.dismissed_at),
      sample_data: { status: demo.status, step: demo.step },
      reset_in_progress: demo.status === 'resetting',
    };
  }

  /**
   * `PUT /onboarding/choice` with `{ angle?, mode? }`. A field left out keeps its value. The first
   * user who answers sets a field; changing a field already set takes an administrator. The
   * tenant's row is locked, so two first answers at the same time apply one after the other.
   */
  async setChoice(manager: EntityManager, tenantId: string, userId: string, body: unknown): Promise<OnboardingState> {
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
    await this.afterChoice(manager, {
      tenantId,
      userId,
      angle: angleChanges ? { value: angle!, previous: previousAngle } : null,
      mode: modeChanges ? { value: mode!, previous: previousMode } : null,
    });
    return this.getState(manager, tenantId, userId);
  }

  /**
   * What a new choice sets off, once written and logged, in the request's transaction. Nothing
   * yet: the effect of `own_data` (resetting the workspace) comes here.
   */
  protected async afterChoice(_manager: EntityManager, _change: OnboardingChoiceChange): Promise<void> {
    return;
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
      const [progress]: Array<{ done: number; logged: boolean }> = await manager.query(
        `SELECT
           (SELECT count(*)::int FROM onboarding_steps
             WHERE tenant_id = $1 AND user_id = $2 AND angle = $3 AND mode = $4 AND step_key = ANY($5::text[])) AS done,
           EXISTS (
             SELECT 1 FROM audit_log
              WHERE tenant_id = $1 AND record_id = $1 AND table_name = $6 AND action = 'onboarding.completed'
                AND user_id = $2 AND after_json->>'angle' = $3 AND after_json->>'mode' = $4
           ) AS logged`,
        [tenantId, userId, angle, mode, [...path], ONBOARDING_AUDIT_TABLE],
      );
      if (progress && progress.done === path.length && !progress.logged) {
        await this.audit(manager, tenantId, userId, 'onboarding.completed', { angle, mode });
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
