import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiExecutionContextWithManager } from '../../ai.types';
import { AiReadonlyDiagnosticWorkflowService, DiagnosticWorkflowResult } from '../diagnostics/ai-readonly-diagnostic-workflow.service';
import { AiAutonomyRoutine } from '../entities/ai-autonomy-routine.entity';
import { isRecord } from '../../../common/object-guards';
import { codedForbidden } from '../../../auth/module-right-required';

type RoutineTriggerInput = {
  routineKey: string;
  alertId?: string | null;
  providerKey?: string | null;
};

function stringField(value: Record<string, unknown> | null | undefined, key: string): string | null {
  const raw = value?.[key];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

@Injectable()
export class AiAutonomyRoutineService {
  constructor(
    @InjectRepository(AiAutonomyRoutine)
    private readonly routineRepo: Repository<AiAutonomyRoutine>,
    private readonly diagnostics: AiReadonlyDiagnosticWorkflowService,
  ) {}

  private repo(context: AiExecutionContextWithManager) {
    return context.manager.getRepository(AiAutonomyRoutine);
  }

  private async getEnabledRoutine(
    context: AiExecutionContextWithManager,
    routineKey: string,
    triggerKind: 'scheduled' | 'alert',
  ): Promise<AiAutonomyRoutine> {
    const routine = await this.repo(context).findOne({
      where: {
        tenant_id: context.tenantId,
        routine_key: routineKey,
        trigger_kind: triggerKind,
      },
    });
    if (!routine) {
      throw new BadRequestException('Autonomy routine was not found for this tenant and trigger.');
    }
    if (!routine.enabled) {
      throw codedForbidden('AUTONOMY_ROUTINE_DISABLED', 'Autonomy routine is disabled.');
    }
    if (routine.workflow_type !== 'readonly_diagnostic') {
      throw codedForbidden('AGENT_NOT_AVAILABLE_YET', 'Autonomy routine workflow is not enabled for Phase 6.');
    }
    if (routine.max_runs_per_window !== 1) {
      throw codedForbidden('AGENT_NOT_AVAILABLE_YET', 'Phase 6 routines are bounded to one diagnostic run per trigger.');
    }
    return routine;
  }

  private assertProviderScope(routine: AiAutonomyRoutine, requestedProviderKey?: string | null) {
    if (requestedProviderKey && requestedProviderKey !== routine.provider_key) {
      throw codedForbidden('AGENT_SETTINGS_INVALID', 'Autonomy routine provider override does not match the routine provider.');
    }
  }

  private assertCooldownAvailable(routine: AiAutonomyRoutine, now = new Date()) {
    if (!Number.isInteger(routine.cooldown_seconds) || routine.cooldown_seconds < 0) {
      throw codedForbidden('AGENT_SETTINGS_INVALID', 'Autonomy routine cooldown is malformed.');
    }
    if (routine.cooldown_seconds === 0 || !routine.last_triggered_at) {
      return;
    }
    const lastTriggered = routine.last_triggered_at instanceof Date
      ? routine.last_triggered_at
      : new Date(routine.last_triggered_at);
    if (!Number.isFinite(lastTriggered.getTime())) {
      throw codedForbidden('AGENT_SETTINGS_INVALID', 'Autonomy routine last trigger timestamp is malformed.');
    }
    const cooldownMs = routine.cooldown_seconds * 1000;
    if (now.getTime() - lastTriggered.getTime() < cooldownMs) {
      throw codedForbidden('AGENT_COOLDOWN_ACTIVE', 'Autonomy routine cooldown is active.');
    }
  }

  private async reserveRoutineTrigger(
    context: AiExecutionContextWithManager,
    routine: AiAutonomyRoutine,
  ): Promise<AiAutonomyRoutine> {
    this.assertCooldownAvailable(routine);
    const managerWithQuery = context.manager as typeof context.manager & {
      query?: (sql: string, parameters?: unknown[]) => Promise<unknown>;
    };
    if (typeof managerWithQuery.query === 'function') {
      const result = await managerWithQuery.query(`
        UPDATE ai_autonomy_routines
        SET last_triggered_at = now(), updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
          AND (
            cooldown_seconds <= 0
            OR last_triggered_at IS NULL
            OR last_triggered_at <= now() - (cooldown_seconds * interval '1 second')
          )
        RETURNING last_triggered_at, updated_at
      `, [context.tenantId, routine.id]);
      const rows = Array.isArray(result) ? result : [];
      if (rows.length === 0) {
        throw codedForbidden('AGENT_COOLDOWN_ACTIVE', 'Autonomy routine cooldown is active.');
      }
      const [row] = rows as Array<{ last_triggered_at?: Date | string; updated_at?: Date | string }>;
      routine.last_triggered_at = row.last_triggered_at ? new Date(row.last_triggered_at) : new Date();
      routine.updated_at = row.updated_at ? new Date(row.updated_at) : new Date();
      return routine;
    }

    routine.last_triggered_at = new Date();
    routine.updated_at = new Date();
    await this.repo(context).save(routine);
    return routine;
  }

  private async getReservedRoutine(
    context: AiExecutionContextWithManager,
    input: RoutineTriggerInput,
    triggerKind: 'scheduled' | 'alert',
  ): Promise<AiAutonomyRoutine> {
    const routine = await this.getEnabledRoutine(context, input.routineKey, triggerKind);
    this.assertProviderScope(routine, input.providerKey);
    return this.reserveRoutineTrigger(context, routine);
  }

  async runScheduledDiagnostic(
    context: AiExecutionContextWithManager,
    input: RoutineTriggerInput,
  ): Promise<DiagnosticWorkflowResult> {
    const routine = await this.getReservedRoutine(context, input, 'scheduled');
    const routineInput = isRecord(routine.input_json) ? routine.input_json : {};
    const result = await this.diagnostics.runMockDiagnostic(context, {
      provider_key: routine.provider_key,
      alert_id: stringField(routineInput, 'alert_id') ?? input.alertId ?? 'mock-alert-001',
      include_directory: routineInput.include_directory === true,
      user_id_or_email: stringField(routineInput, 'user_id_or_email') ?? undefined,
      continue_on_provider_error: false,
    }, {
      surface: 'scheduler',
      trigger_kind: 'scheduled_trigger',
      metadata: {
        autonomy_routine_id: routine.id,
        autonomy_routine_key: routine.routine_key,
        autonomy_trigger: 'scheduled',
      },
    });
    return result;
  }

  async runAlertDiagnostic(
    context: AiExecutionContextWithManager,
    input: RoutineTriggerInput,
  ): Promise<DiagnosticWorkflowResult> {
    const routine = await this.getReservedRoutine(context, input, 'alert');
    const routineInput = isRecord(routine.input_json) ? routine.input_json : {};
    const result = await this.diagnostics.runMockDiagnostic(context, {
      provider_key: routine.provider_key,
      alert_id: input.alertId ?? stringField(routineInput, 'alert_id') ?? 'mock-alert-001',
      include_directory: routineInput.include_directory === true,
      user_id_or_email: stringField(routineInput, 'user_id_or_email') ?? undefined,
      continue_on_provider_error: false,
    }, {
      surface: 'alert',
      trigger_kind: 'alert_trigger',
      metadata: {
        autonomy_routine_id: routine.id,
        autonomy_routine_key: routine.routine_key,
        autonomy_trigger: 'alert',
      },
    });
    return result;
  }
}
