import { AI_REASONING_EFFORTS, AiReasoningEffort } from './ai-provider.types';

/**
 * Which reasoning efforts a provider and model accept: the single source the model configuration
 * checks, the calls send and the AI model dialog offers (GET /ai/model-configs/reasoning-efforts).
 *
 * - Anthropic (`output_config.effort`), per model: Opus 4.5 takes low, medium and high; Opus 4.6
 *   and Sonnet 4.6 add max; Opus 4.7 and later, Sonnet 5 and later, Haiku 5.5 and later, Fable and
 *   Mythos take all five. Older models (Haiku 4.5, Sonnet 4.5, Opus 4.1...) take no effort.
 * - OpenAI (`reasoning_effort`): every KANAP level is an OpenAI level name. OpenAI also has
 *   `none` and `minimal`, which KANAP does not store. Which model accepts which level is not
 *   listed in one place: a refusal shows in the connection test.
 * - Ollama and custom endpoints receive the field as set; the server may ignore it.
 */
export type AiReasoningEffortSupport = {
  // The levels to offer, in increasing order; empty when the model takes no effort.
  levels: AiReasoningEffort[];
  // True when KANAP cannot know what the server does with the field (Ollama, custom endpoints).
  serverMayIgnore: boolean;
};

const ALL_EFFORTS: AiReasoningEffort[] = [...AI_REASONING_EFFORTS];
const WITHOUT_XHIGH: AiReasoningEffort[] = ['low', 'medium', 'high', 'max'];
const LOW_TO_HIGH: AiReasoningEffort[] = ['low', 'medium', 'high'];

/** The efforts an Anthropic model accepts in `output_config.effort`; empty when it takes none. */
export function anthropicModelEfforts(model: string): AiReasoningEffort[] {
  const id = String(model || '').trim().toLowerCase().replace(/^anthropic\./, '');
  if (/^claude-(fable|mythos)-/.test(id)) return ALL_EFFORTS;
  const match = /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d+))?/.exec(id);
  if (!match) return [];
  const major = Number(match[2]);
  // A long numeric suffix is a snapshot date (claude-opus-4-20250514), not a minor version.
  const minor = match[3] && match[3].length <= 2 ? Number(match[3]) : 0;
  const version = major + minor / 10;
  switch (match[1]) {
    case 'opus':
      if (version >= 4.7) return ALL_EFFORTS;
      if (version >= 4.6) return WITHOUT_XHIGH;
      return version >= 4.5 ? LOW_TO_HIGH : [];
    case 'sonnet':
      if (version >= 5) return ALL_EFFORTS;
      return version >= 4.6 ? WITHOUT_XHIGH : [];
    default:
      return version >= 5.5 ? ALL_EFFORTS : [];
  }
}

/** Whether an Anthropic model accepts `output_config.effort` at all. */
export function anthropicModelSupportsEffort(model: string): boolean {
  return anthropicModelEfforts(model).length > 0;
}

export function reasoningEffortSupport(
  provider: string | null | undefined,
  model: string | null | undefined,
): AiReasoningEffortSupport {
  if (provider === 'anthropic') {
    return { levels: anthropicModelEfforts(model ?? ''), serverMayIgnore: false };
  }
  if (provider === 'openai') {
    return { levels: ALL_EFFORTS, serverMayIgnore: false };
  }
  return { levels: ALL_EFFORTS, serverMayIgnore: true };
}

/**
 * The effort a call to this provider and model actually sends: the configured one when the model
 * accepts it, else null (nothing sent, the provider's default applies).
 */
export function reasoningEffortToSend(
  provider: string | null | undefined,
  model: string | null | undefined,
  effort: AiReasoningEffort | null | undefined,
): AiReasoningEffort | null {
  if (!effort) return null;
  return reasoningEffortSupport(provider, model).levels.includes(effort) ? effort : null;
}
