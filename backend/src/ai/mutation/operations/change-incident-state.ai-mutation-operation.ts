import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { IncidentsService } from '../../../incidents/services/incidents.service';
import { AiMutationPreview } from '../../ai-mutation-preview.entity';
import {
  AiWriteLanguage,
  PREVIEW_INCIDENT_REVIEW_LOCKED_MESSAGE,
  incidentCancelWarning,
  incidentReasonLabel,
  previewSummaryText,
  quoted,
  writeActionText,
} from '../../ai-write-texts';
import { AiExecutionContextWithManager } from '../../ai.types';
import { buildAiMutationAudit } from '../ai-mutation-audit.util';
import { AiIncidentMutationSupportService } from '../ai-incident-mutation-support.service';
import {
  AiMutationOperation,
  AiMutationPreviewPresentation,
  AiPreparedMutationPreview,
} from '../ai-mutation-operation.types';

const ACTIONS = ['reopen', 'cancel'] as const;
type ChangeIncidentStateAction = (typeof ACTIONS)[number];

type ChangeIncidentStateInput = {
  ref: string;
  action: ChangeIncidentStateAction;
  reason: string;
};

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function actionOf(value: unknown): ChangeIncidentStateAction {
  return value === 'cancel' ? 'cancel' : 'reopen';
}

function buildTarget(preview: AiMutationPreview): AiMutationPreviewPresentation['target'] {
  const current = preview.current_values ?? {};
  return {
    entity_type: 'incidents',
    entity_id: preview.target_entity_id ?? null,
    ref: typeof current.target_ref === 'string' ? current.target_ref : null,
    title: typeof current.target_title === 'string' ? current.target_title : null,
  };
}

/**
 * An administrator reopens or cancels one incident, through `IncidentsService.reopen` and
 * `cancel`: the screen's row lock, its review snapshot, its journal entry and its audit row stay
 * the service's. The reason is mandatory, as on the screen. Reopening refuses an open or
 * in-progress incident before the preview; cancelling refuses a frozen record. Both freeze the
 * record on cancellation and cannot be undone: going back would need the opposite administrator
 * action.
 */
@Injectable()
export class ChangeIncidentStateAiMutationOperation implements AiMutationOperation<ChangeIncidentStateInput> {
  readonly toolName = 'change_incident_state' as const;
  readonly description = 'Create a preview for a register administrator to reopen or cancel one incident, with a mandatory reason. Requires explicit user approval before execution.';
  readonly inputSchema = z.object({
    ref: z.string().trim().min(1)
      .describe('Incident reference: an INC-n reference, the incident UUID, or its exact title.'),
    action: z.enum(ACTIONS)
      .describe('`reopen` moves a resolved, closed or cancelled incident back to in progress; `cancel` cancels an editable incident and freezes it.'),
    reason: z.string().trim().min(1)
      .describe('The reason of the reopen or the cancellation; it is written in the incident journal and cannot be empty.'),
  });
  readonly inputSummary = {
    ref: 'Incident reference: INC-n, the incident UUID, or its exact title.',
    action: '`reopen` or `cancel`.',
    reason: 'The mandatory reason, stored in the incident journal.',
  };
  readonly businessResource = 'incidents';
  readonly writePreview = {
    entity_type: 'incidents',
    fields: ['status', 'reason'],
    reversible: false,
    prompt_hint: 'For reopening or cancelling an incident, use `change_incident_state` with an INC reference, `action` (`reopen` or `cancel`) and the person\'s mandatory reason. It needs the register administrator right. Reopening refuses an open or in-progress incident; cancelling refuses a closed or cancelled one and freezes the record, so only an administrator can reopen it. The preview cannot be undone. Lifting the confidentiality has `set_incident_confidentiality`.',
  };

  constructor(
    private readonly support: AiIncidentMutationSupportService,
    private readonly incidents: IncidentsService,
  ) {}

  resolveWriteFamily(): string {
    return 'incidents';
  }

  async prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: ChangeIncidentStateInput,
  ): Promise<AiPreparedMutationPreview> {
    const incident = await this.support.resolveIncident(context, input.ref);
    const reason = textOrNull(input.reason);
    if (!reason) throw new BadRequestException('Reason is required.');
    const action = actionOf(input.action);
    if (action === 'reopen') {
      // The service's own refusal, before the preview: the screen's reopen button is disabled.
      if (incident.status === 'open' || incident.status === 'in_progress') {
        throw new BadRequestException('Only resolved, closed or cancelled incidents can be reopened.');
      }
    } else {
      this.support.assertEditable(incident);
    }

    return {
      targetEntityType: 'incidents',
      targetEntityId: incident.id,
      mutationInput: {
        action,
        reason,
        from_status: incident.status,
        to_status: action === 'reopen' ? 'in_progress' : 'cancelled',
      },
      currentValues: {
        target_ref: incident.ref,
        target_title: incident.label,
        status: incident.status,
      },
    };
  }

  presentPreview(preview: AiMutationPreview, language: AiWriteLanguage = 'en'): AiMutationPreviewPresentation {
    const current = preview.current_values ?? {};
    const mutation = preview.mutation_input ?? {};
    const action = actionOf(mutation.action);
    const ref = typeof current.target_ref === 'string' ? current.target_ref : 'INC';
    const label = typeof current.target_title === 'string' && current.target_title.trim()
      ? current.target_title
      : ref;
    const from = textOrNull(mutation.from_status);
    const to = textOrNull(mutation.to_status) ?? (action === 'reopen' ? 'in_progress' : 'cancelled');
    const reason = textOrNull(mutation.reason);

    let summary = `Preview ${preview.id} ${preview.status}.`;
    switch (preview.status) {
      case 'pending':
        summary = action === 'reopen' ? `Reopen ${label}.` : `Cancel ${label}.`;
        break;
      case 'executed':
        summary = action === 'reopen' ? `Reopened ${label}.` : `Cancelled ${label}.`;
        break;
      case 'rejected':
        summary = `${action === 'reopen' ? 'Reopen' : 'Cancel'} preview for ${label} was rejected.`;
        break;
      case 'expired':
        summary = `${action === 'reopen' ? 'Reopen' : 'Cancel'} preview for ${label} expired before approval.`;
        break;
      case 'failed':
        summary = preview.error_message || `${action === 'reopen' ? 'Reopen' : 'Cancel'} preview for ${label} failed.`;
        break;
    }

    if (language !== 'en') {
      summary = previewSummaryText(
        language,
        preview.status,
        writeActionText.changeIncidentState(language, action, quoted(language, label)),
        { errorMessage: preview.error_message },
      );
    }

    return {
      target: buildTarget(preview),
      changes: {
        status: {
          label: 'Status',
          from,
          to,
          format: 'text',
        },
        reason: {
          label: incidentReasonLabel(language),
          from: null,
          to: reason,
          format: 'text',
        },
        ...(action === 'cancel' ? {
          cancel_warning: {
            label: 'Cancellation',
            from: null,
            to: incidentCancelWarning(language),
            format: 'text' as const,
          },
        } : {}),
      },
      summary,
    };
  }

  async executePreview(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
  ): Promise<void> {
    const mutation = preview.mutation_input ?? {};
    const action = actionOf(mutation.action);
    const reason = textOrNull(mutation.reason);
    if (!reason) throw new BadRequestException('Preview is missing the reason.');
    if (!preview.target_entity_id) throw new BadRequestException('Preview is missing the incident.');
    // The visibility and the state are checked again when the preview runs.
    const incident = await this.support.resolveIncident(context, preview.target_entity_id);
    const expectedStatus = textOrNull(mutation.from_status);
    // Another change moved the status since the preview: refuse rather than act on another state.
    if (expectedStatus && incident.status !== expectedStatus) {
      throw new ConflictException(`${incident.ref} changed after the preview was created.`);
    }
    if (action === 'reopen' && (incident.status === 'open' || incident.status === 'in_progress')) {
      throw new BadRequestException('Only resolved, closed or cancelled incidents can be reopened.');
    }
    if (action === 'cancel') this.support.assertEditable(incident);
    const options = await this.support.writeOptions(context);
    const serviceOptions = {
      manager: options.manager,
      tenantId: options.tenantId,
      viewer: options.viewer,
      audit: buildAiMutationAudit(preview),
    };
    try {
      if (action === 'reopen') {
        await this.incidents.reopen(incident.id, reason, context.userId, serviceOptions);
      } else {
        await this.incidents.cancel(incident.id, reason, context.userId, serviceOptions);
      }
    } catch (error) {
      // The review is being edited by somebody else: the 423 reads as the screen's sentence.
      if ((error as { getStatus?: () => number })?.getStatus?.() === 423) {
        throw new BadRequestException(PREVIEW_INCIDENT_REVIEW_LOCKED_MESSAGE);
      }
      throw error;
    }
  }
}
