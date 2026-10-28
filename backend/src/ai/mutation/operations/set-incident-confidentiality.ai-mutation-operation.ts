import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { IncidentsService } from '../../../incidents/services/incidents.service';
import { AiMutationPreview } from '../../ai-mutation-preview.entity';
import {
  AiWriteLanguage,
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

type SetIncidentConfidentialityInput = {
  ref: string;
  confidential: boolean;
};

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
 * A register administrator sets or lifts the confidentiality of one incident, through
 * `IncidentsService.setConfidentiality`: the route of the screen also works on a closed record,
 * so this tool is not gated by the closure lock. It needs the administrator right in both
 * directions, and a register administrator keeps access, so the card carries no lose-access
 * warning. Lifting it by `update_business_record` stays refused; this tool is the way.
 */
@Injectable()
export class SetIncidentConfidentialityAiMutationOperation implements AiMutationOperation<SetIncidentConfidentialityInput> {
  readonly toolName = 'set_incident_confidentiality' as const;
  readonly description = 'Create a preview for a register administrator to set or lift the confidentiality of one incident, including a closed or cancelled record. Requires explicit user approval before execution.';
  readonly inputSchema = z.object({
    ref: z.string().trim().min(1)
      .describe('Incident reference: an INC-n reference, the incident UUID, or its exact title.'),
    confidential: z.boolean()
      .describe('`true` restricts the incident to register administrators, the reporter and the owner; `false` lifts the restriction.'),
  });
  readonly inputSummary = {
    ref: 'Incident reference: INC-n, the incident UUID, or its exact title.',
    confidential: '`true` to restrict the incident, `false` to lift the restriction.',
  };
  readonly businessResource = 'incidents';
  readonly writePreview = {
    entity_type: 'incidents',
    fields: ['confidential'],
    reversible: false,
    prompt_hint: 'For the confidentiality of an incident, use `set_incident_confidentiality` with an INC reference and `confidential` (`true` restricts, `false` lifts). It needs the register administrator right, for both directions, and works on an open or a frozen record. A register administrator keeps access, so the card carries no lose-access warning. The preview cannot be undone; setting the confidentiality stays possible through `update_business_record`, lifting it does not.',
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
    input: SetIncidentConfidentialityInput,
  ): Promise<AiPreparedMutationPreview> {
    const incident = await this.support.resolveIncident(context, input.ref);
    const confidential = input.confidential === true;
    if (incident.confidential === confidential) {
      throw new BadRequestException(
        confidential ? 'This incident is already confidential.' : 'This incident is already public.',
      );
    }
    return {
      targetEntityType: 'incidents',
      targetEntityId: incident.id,
      mutationInput: {
        confidential,
        from_confidential: incident.confidential,
      },
      currentValues: {
        target_ref: incident.ref,
        target_title: incident.label,
        status: incident.status,
        confidential: incident.confidential,
      },
    };
  }

  presentPreview(preview: AiMutationPreview, language: AiWriteLanguage = 'en'): AiMutationPreviewPresentation {
    const current = preview.current_values ?? {};
    const mutation = preview.mutation_input ?? {};
    const ref = typeof current.target_ref === 'string' ? current.target_ref : 'INC';
    const label = typeof current.target_title === 'string' && current.target_title.trim()
      ? current.target_title
      : ref;
    const confidential = mutation.confidential === true;
    const from = confidential ? 'No' : 'Yes';
    const to = confidential ? 'Yes' : 'No';
    let summary = `Preview ${preview.id} ${preview.status}.`;
    switch (preview.status) {
      case 'pending':
        summary = confidential ? `Restrict ${label}.` : `Lift the confidentiality of ${label}.`;
        break;
      case 'executed':
        summary = confidential ? `Confidentiality set on ${label}.` : `Confidentiality lifted on ${label}.`;
        break;
      case 'rejected':
        summary = `Confidentiality preview for ${label} was rejected.`;
        break;
      case 'expired':
        summary = `Confidentiality preview for ${label} expired before approval.`;
        break;
      case 'failed':
        summary = preview.error_message || `Confidentiality preview for ${label} failed.`;
        break;
    }

    if (language !== 'en') {
      summary = previewSummaryText(
        language,
        preview.status,
        writeActionText.setIncidentConfidentiality(language, confidential, quoted(language, label)),
        { errorMessage: preview.error_message },
      );
    }

    return {
      target: buildTarget(preview),
      changes: {
        confidential: {
          label: 'Confidential',
          from,
          to,
          format: 'text',
        },
      },
      summary,
    };
  }

  async executePreview(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
  ): Promise<void> {
    const mutation = preview.mutation_input ?? {};
    const confidential = mutation.confidential === true;
    if (!preview.target_entity_id) throw new BadRequestException('Preview is missing the incident.');
    // The visibility is checked again when the preview runs; the state may be frozen, as the
    // screen's confidentiality route accepts a closed record.
    const incident = await this.support.resolveIncident(context, preview.target_entity_id);
    const expectedConfidential = mutation.from_confidential;
    // The flag moved since the preview, or a preview without the stored value would write nothing:
    // refuse instead of marking it executed.
    if (typeof expectedConfidential === 'boolean'
      ? incident.confidential !== expectedConfidential
      : incident.confidential === confidential) {
      throw new ConflictException(`${incident.ref} changed after the preview was created.`);
    }
    const options = await this.support.writeOptions(context);
    await this.incidents.setConfidentiality(
      incident.id,
      confidential,
      context.userId,
      {
        manager: options.manager,
        tenantId: options.tenantId,
        viewer: options.viewer,
        audit: buildAiMutationAudit(preview),
      },
    );
  }
}
