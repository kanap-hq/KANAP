import type { AiRun } from '../entities/ai-run.entity';

/**
 * Who reads the result of a tool call.
 *
 * A run belongs to an agent or to a person. An agent's run (ticket triage, a scheduled or alert
 * diagnosis, a test from the agents screens) is read in full by the roles of those screens. A
 * person's run comes from a conversation with the assistant or from a call through their MCP key
 * or connection: the screens that list runs show its line (who, when, which tool, on what) to the
 * same roles, and what the tool returned only to that person and to an Administrator whose access
 * to data is not limited.
 *
 * The rule is read from the run's origin, which the dispatcher has written on every run since the
 * first one: results kept earlier follow it too.
 */

const AUTOMATION_CHANNELS: ReadonlySet<string> = new Set(['internal', 'scheduler', 'alert']);
const AUTOMATION_TRIGGERS: ReadonlySet<string> = new Set(['internal', 'scheduled_trigger', 'alert_trigger']);

export type RunOrigin = Pick<AiRun, 'invocation_channel' | 'trigger_kind' | 'user_id'>;

/**
 * A run a person started: the assistant's tools (`chat` / `human_user`), a write the person
 * approved in the conversation (`internal` / `human_user`), an MCP call (`mcp` / `mcp_client`).
 * A run that is not plainly an agent's counts as a person's.
 */
export function isPersonRun(run: Pick<RunOrigin, 'invocation_channel' | 'trigger_kind'>): boolean {
  return !(AUTOMATION_CHANNELS.has(run.invocation_channel) && AUTOMATION_TRIGGERS.has(run.trigger_kind));
}

/** Whether the reader of the current request reads what the tools of this run returned. */
export type RunResultAccess = (run: RunOrigin) => Promise<boolean>;

/**
 * The access of one reader, for one request. `readsEveryResult` is asked at most once, and only
 * when the reader meets a run of another person.
 */
export function runResultAccess(
  readerUserId: string | null | undefined,
  readsEveryResult: () => Promise<boolean>,
): RunResultAccess {
  let everyResult: Promise<boolean> | null = null;
  return async (run) => {
    if (!isPersonRun(run)) return true;
    if (readerUserId && run.user_id === readerUserId) return true;
    everyResult ??= readsEveryResult();
    return everyResult;
  };
}

// The summary of an object lists its keys (`AiEvidenceService.summarize`): for the input of a
// tool, the names of the arguments.
const ARGUMENT_NAMES = /^Object keys: /;

/**
 * What the line of a call keeps of its input for a reader who does not read its result: the names
 * of the arguments. Their values stay with the result: the `arguments` an MCP call keeps, a
 * summary that quotes a text or a list, and the fingerprint of the input, which confirms a guess
 * on simple arguments.
 */
export function inputWithoutValues(inputSummary: unknown): { summary: string } | null {
  if (!inputSummary || typeof inputSummary !== 'object' || Array.isArray(inputSummary)) return null;
  const { summary } = inputSummary as Record<string, unknown>;
  return typeof summary === 'string' && ARGUMENT_NAMES.test(summary) ? { summary } : null;
}

/**
 * The metadata of a tool call for a reader who does not read its result. The message of a failure
 * quotes what was asked and what was found: the failure a tool reported keeps its code only.
 */
export function metadataWithoutErrorMessage<T extends Record<string, unknown> | null | undefined>(metadata: T): T {
  if (!metadata || !('provider_error' in metadata)) return metadata;
  const kept: Record<string, unknown> = { ...metadata };
  const reported = kept.provider_error;
  if (reported && typeof reported === 'object' && !Array.isArray(reported)) {
    const coded: Record<string, unknown> = { ...reported };
    delete coded.message;
    kept.provider_error = coded;
  } else {
    delete kept.provider_error;
  }
  return kept as T;
}
