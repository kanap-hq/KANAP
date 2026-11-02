import { z } from 'zod';
import { AiMutationPreview } from '../ai-mutation-preview.entity';
import { AiWriteLanguage } from '../ai-write-texts';
import {
  AiExecutionContextWithManager,
  AiMutationPreviewChangeDto,
  AiMutationPreviewDto,
  AiMutationWriteToolName,
  AiWritePreviewCapabilityDto,
} from '../ai.types';

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
