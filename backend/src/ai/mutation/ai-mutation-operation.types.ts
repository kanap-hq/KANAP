import { z } from 'zod';
import { AiMutationPreview } from '../ai-mutation-preview.entity';
import { AiWriteLanguage } from '../ai-write-texts';
import {
  AiBulkEditPreviewDto,
  AiExecutionContextWithManager,
  AiImportMappingPreviewDto,
  AiMutationPreviewChangeDto,
  AiMutationPreviewDto,
  AiMutationWriteToolName,
  AiWritePreviewCapabilityDto,
} from '../ai.types';

/**
 * An approval the operation refuses, with values the card keeps once its execution is undone (lot I2
 * of 26.11.9: what the load of an import refused, row by row, which the failed card shows).
 */
export class AiPreviewExecutionRefusal extends Error {
  constructor(message: string, readonly kept: Record<string, unknown>) {
    super(message);
  }
}

export type AiPreparedMutationPreview = {
  targetEntityType: string;
  targetEntityId: string | null;
  mutationInput: Record<string, unknown>;
  currentValues: Record<string, unknown> | null;
};

export type AiMutationPreviewPresentation = {
  target: AiMutationPreviewDto['target'];
  changes: Record<string, AiMutationPreviewChangeDto>;
  summary: string;
  /** The column mapping of an import (`prepare_import_mapping`). */
  importMapping?: AiImportMappingPreviewDto;
  /** The records a change in bulk lists (`bulk_update_*`). */
  bulkEdit?: AiBulkEditPreviewDto;
  /** What the model is told to do next about this card. */
  assistantNote?: string;
  /** The card's error in the person's language, when the operation words its own (else the fixed preview errors). */
  errorMessage?: string;
};

export interface AiMutationOperation<TInput = unknown> {
  readonly toolName: AiMutationWriteToolName;
  readonly description: string;
  readonly inputSchema: z.ZodTypeAny;
  readonly inputSummary: Record<string, string>;
  readonly businessResource: string;
  readonly businessResources?: readonly string[];
  readonly writePreview: AiWritePreviewCapabilityDto;

  resolveBusinessResource?(params: {
    input?: TInput;
    preview?: AiMutationPreview;
  }): string;

  /** The family the write's level and field rules apply to, when the input names no `entity_type`. */
  resolveWriteFamily?(params: {
    input?: TInput;
    preview?: AiMutationPreview;
  }): string;

  prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: TInput,
  ): Promise<AiPreparedMutationPreview>;

  /** Whether `replacement` replaces the person's `pending` preview of this tool in the conversation: the pending one then expires. */
  replacesPendingPreview?(pending: AiMutationPreview, replacement: AiMutationPreview): boolean;

  /**
   * With `replacesPendingPreview`: what the previews that replace one another share, read from an
   * input or a stored `mutation_input` (an import's attached file). The creations and the choices of
   * one scope in a conversation take turns (an advisory lock), so that one preview stays pending.
   */
  replacementScope?(input: Record<string, unknown>): string | null;

  /**
   * Whether a pending preview can be approved as it stands (an import whose check refused the file
   * cannot). "Approve all" leaves out the ones that cannot; approved on its own, one fails.
   */
  isApprovable?(preview: AiMutationPreview): boolean;

  /**
   * Why a pending preview's approval is refused while the preview stays pending (an import with
   * nothing to import, which a choice on the card can change), or null. A fixed preview error
   * (`ai-write-texts`), checked before anything runs.
   */
  approvalRefusal?(preview: AiMutationPreview): string | null;

  /**
   * A change in bulk recounted with records the person left out (lot K2e of 26.12.1): the new card,
   * from the stored selection and the change already resolved, never from the model's words again.
   * `excluded` are ids the card lists; any other is refused. The left out records stay listed, unticked.
   */
  prepareExclusions?(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
    excluded: string[],
  ): Promise<AiPreparedMutationPreview>;

  /** The card of a preview: its summary in the person's language (English when not given). */
  presentPreview(preview: AiMutationPreview, language?: AiWriteLanguage): AiMutationPreviewPresentation;

  executePreview(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
  ): Promise<void>;

  prepareReversePreview?(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
  ): Promise<AiPreparedMutationPreview>;

  /**
   * The inputs of every plan step of this tool, when there are two or more: throws when two of
   * them reach the same records, before the plan is saved.
   */
  assertPlanStepsDisjoint?(
    context: AiExecutionContextWithManager,
    inputs: Array<Record<string, unknown>>,
  ): Promise<void>;
}
