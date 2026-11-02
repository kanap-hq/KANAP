import { BadRequestException, Injectable } from '@nestjs/common';
import { AiExecutionContextWithManager } from '../../ai.types';
import { AiApprovalService } from '../approval/ai-approval.service';
import {
  AUTOMATION_JOB_DRY_RUN_CAPABILITY,
  TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY,
  TICKETING_INTERNAL_NOTE_PREPARE_CAPABILITY,
} from '../capability/capability-contract';
import { AiCapabilityDispatcherService } from '../dispatcher/ai-capability-dispatcher.service';
import { AiProviderRegistryService } from '../providers/provider-registry.service';
import { AiLiveTestTarget } from '../entities/ai-live-test-target.entity';
import {
  AiLiveTestTargetService,
  LiveTestAllowedEffect,
  normalizeLiveTargetSelector,
} from './ai-live-test-target.service';
import { codedForbidden } from '../../../auth/module-right-required';

export type LiveContractScenarioKey =
  | 'ticketing_read'
  | 'glpi_read'
  | 'monitoring_read'
  | 'prtg_read'
  | 'nutanix_read'
  | 'ad_read'
  | 'awx_dry_run'
  | 'ticketing_sandbox_write'
  | 'glpi_sandbox_write';

export type LiveContractScenario = {
  key: LiveContractScenarioKey;
  gate: string;
  providerKind: 'ticketing' | 'monitoring' | 'virtualization' | 'directory' | 'automation';
  allowedEffect: LiveTestAllowedEffect;
  targetKind: string;
  capabilityName: string;
  description: string;
};

export type LiveContractStatus =
  | { status: 'skipped'; scenario: LiveContractScenarioKey; reason: string }
  | { status: 'ready'; scenario: LiveContractScenarioKey; target: AiLiveTestTarget }
  | { status: 'failed'; scenario: LiveContractScenarioKey; reason: string };

export const LIVE_CONTRACT_SCENARIOS: Record<LiveContractScenarioKey, LiveContractScenario> = {
  ticketing_read: {
    key: 'ticketing_read',
    gate: 'KANAP_TICKETING_LIVE_READ',
    providerKind: 'ticketing',
    allowedEffect: 'read',
    targetKind: 'ticket',
    capabilityName: 'ticketing.ticket.get',
    description: 'Ticketing provider ticket read contract.',
  },
  glpi_read: {
    key: 'glpi_read',
    gate: 'KANAP_GLPI_LIVE_READ',
    providerKind: 'ticketing',
    allowedEffect: 'read',
    targetKind: 'ticket',
    capabilityName: 'ticketing.ticket.get',
    description: 'GLPI ticket read contract.',
  },
  monitoring_read: {
    key: 'monitoring_read',
    gate: 'KANAP_MONITORING_LIVE_READ',
    providerKind: 'monitoring',
    allowedEffect: 'read',
    targetKind: 'sensor',
    // Nominal capability for reporting; the run exercises the provider reads
    // (getAlert + getSensorHistory + listAlertsForScope) with tiny bounds
    // through the registry-resolved provider, not the dispatcher.
    capabilityName: 'monitoring.alert.get',
    description: 'Monitoring provider bounded sensor read contract (alert, history, scope list).',
  },
  prtg_read: {
    key: 'prtg_read',
    gate: 'KANAP_PRTG_LIVE_READ',
    providerKind: 'monitoring',
    allowedEffect: 'read',
    targetKind: 'alert',
    capabilityName: 'monitoring.alert.get',
    description: 'PRTG alert read contract.',
  },
  nutanix_read: {
    key: 'nutanix_read',
    gate: 'KANAP_NUTANIX_LIVE_READ',
    providerKind: 'virtualization',
    allowedEffect: 'read',
    targetKind: 'vm',
    capabilityName: 'virtualization.vm.health',
    description: 'Nutanix VM health read contract.',
  },
  ad_read: {
    key: 'ad_read',
    gate: 'KANAP_AD_LIVE_READ',
    providerKind: 'directory',
    allowedEffect: 'read',
    targetKind: 'user',
    capabilityName: 'directory.user.context',
    description: 'Active Directory user context read contract.',
  },
  awx_dry_run: {
    key: 'awx_dry_run',
    gate: 'KANAP_AWX_LIVE_DRY_RUN',
    providerKind: 'automation',
    allowedEffect: 'dry_run',
    targetKind: 'awx_job',
    capabilityName: AUTOMATION_JOB_DRY_RUN_CAPABILITY,
    description: 'AWX safe job dry-run contract.',
  },
  ticketing_sandbox_write: {
    key: 'ticketing_sandbox_write',
    gate: 'KANAP_TICKETING_LIVE_SANDBOX_WRITE',
    providerKind: 'ticketing',
    allowedEffect: 'sandbox_write',
    targetKind: 'ticket',
    capabilityName: TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY,
    description: 'Ticketing provider private sandbox ticket note contract.',
  },
  glpi_sandbox_write: {
    key: 'glpi_sandbox_write',
    gate: 'KANAP_GLPI_LIVE_SANDBOX_WRITE',
    providerKind: 'ticketing',
    allowedEffect: 'sandbox_write',
    targetKind: 'ticket',
    capabilityName: TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY,
    description: 'GLPI private sandbox ticket note contract.',
  },
};

export function isLiveContractGlobalGateEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.KANAP_LIVE_CONTRACT_TESTS === '1';
}

function envValue(env: Record<string, string | undefined>, key: string): string | null {
  const value = env[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function metadataRecord(target: AiLiveTestTarget): Record<string, unknown> {
  return target.metadata_json && typeof target.metadata_json === 'object' && !Array.isArray(target.metadata_json)
    ? target.metadata_json
    : {};
}

function variablesFromMetadata(target: AiLiveTestTarget): Record<string, unknown> {
  const metadata = metadataRecord(target);
  return metadata.variables && typeof metadata.variables === 'object' && !Array.isArray(metadata.variables)
    ? metadata.variables as Record<string, unknown>
    : {};
}

async function assertLiveTenantSlugMatchesContext(
  context: AiExecutionContextWithManager,
  env: Record<string, string | undefined>,
): Promise<string> {
  const tenantSlug = envValue(env, 'KANAP_LIVE_TENANT_SLUG');
  if (!tenantSlug) {
    throw codedForbidden('LIVE_TEST_NOT_READY', 'KANAP_LIVE_TENANT_SLUG is required when live contracts are enabled.');
  }
  if (typeof context.manager?.query !== 'function') {
    throw codedForbidden('LIVE_TEST_NOT_READY', 'Live contract tenant slug cannot be verified without a database-backed tenant context.');
  }
  const rows = await context.manager.query(
    `SELECT id::text AS id, slug::text AS slug
     FROM tenants
     WHERE id = $1
       AND deleted_at IS NULL
     LIMIT 1`,
    [context.tenantId],
  );
  const resolvedSlug = typeof rows?.[0]?.slug === 'string' ? rows[0].slug.trim().toLowerCase() : '';
  if (!resolvedSlug || resolvedSlug !== tenantSlug.toLowerCase()) {
    throw codedForbidden('LIVE_TEST_NOT_READY', 'KANAP_LIVE_TENANT_SLUG does not match the execution tenant context.');
  }
  return tenantSlug;
}

@Injectable()
export class AiLiveContractHarnessService {
  constructor(
    private readonly targets: AiLiveTestTargetService,
    private readonly providers: AiProviderRegistryService,
    private readonly dispatcher: AiCapabilityDispatcherService,
    private readonly approvals: AiApprovalService,
  ) {}

  async readiness(
    context: AiExecutionContextWithManager,
    scenarioKey: LiveContractScenarioKey,
    env: Record<string, string | undefined> = process.env,
  ): Promise<LiveContractStatus> {
    const scenario = LIVE_CONTRACT_SCENARIOS[scenarioKey];
    if (!isLiveContractGlobalGateEnabled(env)) {
      return { status: 'skipped', scenario: scenarioKey, reason: 'KANAP_LIVE_CONTRACT_TESTS is not enabled.' };
    }
    if (env[scenario.gate] !== '1') {
      return { status: 'skipped', scenario: scenarioKey, reason: `${scenario.gate} is not enabled.` };
    }
    try {
      await assertLiveTenantSlugMatchesContext(context, env);
      const target = await this.targets.requireSingleEnabledTarget(context, {
        providerKind: scenario.providerKind,
        providerKey: envValue(env, `${scenario.gate}_PROVIDER_KEY`),
        targetKey: envValue(env, `${scenario.gate}_TARGET_KEY`),
        allowedEffect: scenario.allowedEffect,
        targetKind: scenario.targetKind,
      });
      return { status: 'ready', scenario: scenarioKey, target };
    } catch (error: any) {
      return {
        status: 'failed',
        scenario: scenarioKey,
        reason: error?.message ?? 'Live contract safe target is incomplete.',
      };
    }
  }

  async assertReady(
    context: AiExecutionContextWithManager,
    scenarioKey: LiveContractScenarioKey,
    env: Record<string, string | undefined> = process.env,
  ): Promise<{ scenario: LiveContractScenario; target: AiLiveTestTarget }> {
    const status = await this.readiness(context, scenarioKey, env);
    if (status.status === 'skipped') {
      throw codedForbidden('LIVE_TEST_NOT_READY', status.reason);
    }
    if (status.status === 'failed') {
      throw new BadRequestException(status.reason);
    }
    return {
      scenario: LIVE_CONTRACT_SCENARIOS[scenarioKey],
      target: status.target,
    };
  }

  async run(
    context: AiExecutionContextWithManager,
    scenarioKey: LiveContractScenarioKey,
    env: Record<string, string | undefined> = process.env,
  ): Promise<unknown> {
    const { scenario, target } = await this.assertReady(context, scenarioKey, env);
    if (target.provider_key === 'mock') {
      throw codedForbidden('LIVE_TEST_NOT_READY', 'Mock providers cannot satisfy an explicitly enabled live contract.');
    }
    const applicability = await this.providers.getApplicability(context, scenario.providerKind, target.provider_key);
    if (!applicability.available) {
      throw codedForbidden('AGENT_PROVIDER_UNAVAILABLE', `Live adapter unavailable for ${scenario.key}: ${applicability.message ?? applicability.reasonCode}`, { detail: applicability.message ?? applicability.reasonCode });
    }

    if (scenario.allowedEffect === 'sandbox_write' && scenario.providerKind === 'ticketing') {
      return this.runTicketingSandboxWrite(context, target);
    }

    if (scenario.key === 'monitoring_read') {
      return this.runMonitoringRead(context, target);
    }

    const input = this.dispatchInputFor(target, scenario);
    const result = await this.dispatcher.execute(context, {
      capabilityName: scenario.capabilityName,
      input,
      execution: { surface: 'internal', trigger_kind: 'internal' },
    });
    const output = result.output as any;
    if (!output?.ok) {
      throw codedForbidden('AGENT_PROVIDER_UNAVAILABLE', `Live contract returned provider error: ${output?.message ?? output?.errorCode ?? 'unknown'}`, { detail: output?.message ?? output?.errorCode ?? 'unknown' });
    }
    return result;
  }

  private dispatchInputFor(
    target: AiLiveTestTarget,
    scenario: LiveContractScenario,
  ): Record<string, unknown> {
    switch (scenario.key) {
      case 'ticketing_read':
      case 'glpi_read':
        return { provider_key: target.provider_key, ticket_id: target.external_ref };
      case 'prtg_read':
        return { provider_key: target.provider_key, alert_id: target.external_ref };
      case 'nutanix_read':
        return { provider_key: target.provider_key, vm_id: target.external_ref };
      case 'ad_read':
        return { provider_key: target.provider_key, user_id_or_email: target.external_ref };
      case 'awx_dry_run':
        return {
          provider_key: target.provider_key,
          job_key: target.target_key,
          target: normalizeLiveTargetSelector(metadataRecord(target)),
          variables: variablesFromMetadata(target),
        };
      default:
        throw new BadRequestException('Unsupported live contract scenario.');
    }
  }

  // Neutral monitoring read contract: exercises the three read paths the SRE
  // ingestion/diagnosis runtime depends on, with tiny bounds, through the
  // registry-resolved provider. Returns metadata only — never alert text.
  private async runMonitoringRead(
    context: AiExecutionContextWithManager,
    target: AiLiveTestTarget,
  ): Promise<unknown> {
    const provider = await this.providers.monitoring(context, target.provider_key);
    const alert = await provider.getAlert(context, { alertId: target.external_ref }) as any;
    if (!alert?.ok) {
      throw codedForbidden('AGENT_PROVIDER_UNAVAILABLE', `Live monitoring alert read failed: ${alert?.message ?? alert?.errorCode ?? 'unknown'}`, { detail: alert?.message ?? alert?.errorCode ?? 'unknown' });
    }
    const history = await provider.getSensorHistory(context, { sensorId: target.external_ref, windowMinutes: 60 }) as any;
    if (!history?.ok) {
      throw codedForbidden('AGENT_PROVIDER_UNAVAILABLE', `Live monitoring sensor history read failed: ${history?.message ?? history?.errorCode ?? 'unknown'}`, { detail: history?.message ?? history?.errorCode ?? 'unknown' });
    }
    const scoped = await provider.listAlertsForScope(context, { scope: { maxResults: 5 } }) as any;
    if (!scoped?.ok) {
      throw codedForbidden('AGENT_PROVIDER_UNAVAILABLE', `Live monitoring scope list failed: ${scoped?.message ?? scoped?.errorCode ?? 'unknown'}`, { detail: scoped?.message ?? scoped?.errorCode ?? 'unknown' });
    }
    return {
      scenario: 'monitoring_read',
      alert: {
        id: alert.data?.id,
        status: alert.data?.status,
        severity: alert.data?.severity,
        ackState: alert.data?.ackState,
      },
      history_points: Array.isArray(history.data?.points) ? history.data.points.length : 0,
      scoped_alerts: Array.isArray(scoped.data?.alerts) ? scoped.data.alerts.length : 0,
    };
  }

  private async runTicketingSandboxWrite(
    context: AiExecutionContextWithManager,
    target: AiLiveTestTarget,
  ): Promise<unknown> {
    const metadata = metadataRecord(target);
    const noteBody = typeof metadata.note_body === 'string' && metadata.note_body.trim().length > 0
      ? metadata.note_body.trim()
      : `KANAP Phase 8 sandbox private note ${new Date().toISOString()}`;
    const prepared = await this.dispatcher.execute(context, {
      capabilityName: TICKETING_INTERNAL_NOTE_PREPARE_CAPABILITY,
      input: {
        provider_key: target.provider_key,
        ticket_id: target.external_ref,
        note_body: noteBody,
      },
      execution: { surface: 'internal', trigger_kind: 'internal' },
    });
    const actionRequestId = (prepared.output as any)?.data?.action_request_id;
    if (typeof actionRequestId !== 'string') {
      throw codedForbidden('AGENT_ACTION_INCOMPLETE', 'Ticketing sandbox note preparation did not create an action request.');
    }
    await this.approvals.approveActionRequest(context, actionRequestId, {
      source: 'human_ui',
      reason: 'Phase 8 live-readiness sandbox approval fixture.',
    });
    return this.dispatcher.execute(context, {
      capabilityName: TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY,
      input: { action_request_id: actionRequestId },
      execution: { surface: 'internal', trigger_kind: 'internal' },
    });
  }
}
