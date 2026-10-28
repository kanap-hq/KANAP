import { BadRequestException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { IncidentEntriesService } from '../../../incidents/services/incident-entries.service';
import { AiMutationPreview } from '../../ai-mutation-preview.entity';
import {
  AiWriteLanguage,
  incidentNoteLabel,
  incidentOccurredAtLabel,
  previewSummaryText,
  quoted,
  writeActionText,
} from '../../ai-write-texts';
import { AiExecutionContextWithManager } from '../../ai.types';
import { AiIncidentMutationSupportService } from '../ai-incident-mutation-support.service';
import {
  AiMutationOperation,
  AiMutationPreviewPresentation,
  AiPreparedMutationPreview,
} from '../ai-mutation-operation.types';

const ISO_WITH_ZONE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

type AddIncidentNoteInput = {
  ref: string;
  content: string;
  occurred_at?: string | null;
};

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
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
 * A note in the journal of one incident, through `IncidentEntriesService.createNote`: the service
 * keeps the closure lock, the author and the event time, and writes no audit row because the
 * journal itself is the trace. The journal only takes additions, so the preview is not reversible.
 */
@Injectable()
export class AddIncidentNoteAiMutationOperation implements AiMutationOperation<AddIncidentNoteInput> {
  readonly toolName = 'add_incident_note' as const;
  readonly description = 'Create a preview to add one note to the journal of an incident. Requires explicit user approval before execution.';
  readonly inputSchema = z.object({
    ref: z.string().trim().min(1)
      .describe('Incident reference: an INC-n reference, the incident UUID, or its exact title.'),
    content: z.string().trim().min(1)
      .describe('The note text, several lines allowed. Stored as written in the incident journal.'),
    occurred_at: z.union([z.string(), z.null()]).optional()
      .describe('Optional event time as an ISO 8601 date-time with a time zone, converted into the person\'s `time_zone`; defaults to now.'),
  });
  readonly inputSummary = {
    ref: 'Incident reference: INC-n, the incident UUID, or its exact title.',
    content: 'The note text, several lines allowed.',
    occurred_at: 'Optional event time as an ISO 8601 date-time with a time zone; defaults to now.',
  };
  readonly businessResource = 'incidents';
  readonly writePreview = {
    entity_type: 'incidents',
    fields: ['note', 'occurred_at'],
    reversible: false,
    prompt_hint: 'For an incident journal, use `add_incident_note` with an INC reference, the exact note text and, when the person gives one, the event time as an ISO 8601 date-time with a time zone in their `time_zone`. The journal only takes additions: the preview cannot be undone. A closed or cancelled incident is refused. Reopening, cancelling and lifting the confidentiality stay on the incident screen.',
  };

  constructor(
    private readonly support: AiIncidentMutationSupportService,
    private readonly entries: IncidentEntriesService,
  ) {}

  resolveWriteFamily(): string {
    return 'incidents';
  }

  async prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: AddIncidentNoteInput,
  ): Promise<AiPreparedMutationPreview> {
    const incident = await this.support.resolveIncident(context, input.ref);
    this.support.assertEditable(incident);
    const content = textOrNull(input.content);
    if (!content) throw new BadRequestException('Note content is required.');

    const occurredAt = this.normalizeOccurredAt(input.occurred_at);
    return {
      targetEntityType: 'incidents',
      targetEntityId: incident.id,
      mutationInput: {
        content,
        occurred_at: occurredAt,
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
    const ref = typeof current.target_ref === 'string' ? current.target_ref : 'INC';
    const label = typeof current.target_title === 'string' && current.target_title.trim()
      ? current.target_title
      : ref;
    const content = typeof mutation.content === 'string' ? mutation.content : null;
    const occurredAt = typeof mutation.occurred_at === 'string' ? mutation.occurred_at : null;

    let summary = `Preview ${preview.id} ${preview.status}.`;
    switch (preview.status) {
      case 'pending':
        summary = `Add a note to ${label}.`;
        break;
      case 'executed':
        summary = `Note added to ${label}.`;
        break;
      case 'rejected':
        summary = `Note preview for ${label} was rejected.`;
        break;
      case 'expired':
        summary = `Note preview for ${label} expired before approval.`;
        break;
      case 'failed':
        summary = preview.error_message || `Note preview for ${label} failed.`;
        break;
    }

    if (language !== 'en') {
      summary = previewSummaryText(
        language,
        preview.status,
        writeActionText.addIncidentNote(language, quoted(language, label)),
        { errorMessage: preview.error_message },
      );
    }

    return {
      target: buildTarget(preview),
      changes: {
        note: {
          label: incidentNoteLabel(language),
          from: null,
          to: content,
          format: 'markdown',
        },
        ...(occurredAt ? {
          occurred_at: {
            label: incidentOccurredAtLabel(language),
            from: null,
            to: occurredAt,
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
    const content = textOrNull(mutation.content);
    if (!content) throw new BadRequestException('Preview is missing the note content.');
    if (!preview.target_entity_id) throw new BadRequestException('Preview is missing the incident.');

    // The visibility and the closure lock are checked again when the preview runs.
    const incident = await this.support.resolveIncident(context, preview.target_entity_id);
    this.support.assertEditable(incident);
    const occurredAt = textOrNull(mutation.occurred_at);
    const options = await this.support.writeOptions(context);
    await this.entries.createNote(
      incident.id,
      {
        content,
        ...(occurredAt ? { occurred_at: occurredAt } : {}),
      },
      context.userId,
      { manager: options.manager, tenantId: options.tenantId, viewer: options.viewer },
    );
  }

  private normalizeOccurredAt(value: unknown): string | null {
    const text = textOrNull(value);
    if (!text) return null;
    const parsed = new Date(text);
    if (!ISO_WITH_ZONE_RE.test(text) || Number.isNaN(parsed.getTime())) {
      throw new BadRequestException("Occurred at must be an ISO date-time with a time zone, for example 2026-10-28T15:00:00+01:00.");
    }
    return parsed.toISOString();
  }
}
