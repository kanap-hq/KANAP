import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import type { AiRun } from '../entities/ai-run.entity';

/**
 * Who reads the result of a tool call, and which runs the agent lists show.
 *
 * A run belongs to an agent or to a person. An agent's run (ticket triage, a scheduled or alert
 * diagnosis, a test from the agents screens) is read in full by the roles of those screens. A
 * person's run comes from a conversation with the assistant (`chat`, or `internal` with the
 * `human_user` trigger when the person approved a change there) or from a call through their MCP
 * key or connection (`mcp`).
 *
 * The runs route and the errors of the activity list the agents' runs only. The detail of a run
 * keeps its line for the readers of those screens, and what the tool returned for its author, or
 * for an Administrator, who reads all data.
 *
 * The rule is read from the run's origin, which the dispatcher has written on every run since the
 * first one. A run whose conversation was deleted keeps that origin, so the lists leave it out too.
 */

const AUTOMATION_CHANNELS = ['internal', 'scheduler', 'alert'] as const;
const AUTOMATION_TRIGGERS = ['internal', 'scheduled_trigger', 'alert_trigger'] as const;
const AUTOMATION_CHANNEL_SET: ReadonlySet<string> = new Set(AUTOMATION_CHANNELS);
const AUTOMATION_TRIGGER_SET: ReadonlySet<string> = new Set(AUTOMATION_TRIGGERS);

export type AgentRunClause = { sql: string; params: Record<string, readonly string[]> };

/**
 * The SQL form of an agent's run, the complement of `isPersonRun`, built from the same two sets.
 * One clause per set, so a list drops a person's run before it applies its page size.
 */
export function agentRunClauses(alias: string): AgentRunClause[] {
  return [
    {
      sql: `${alias}.invocation_channel IN (:...${alias}AgentChannels)`,
      params: { [`${alias}AgentChannels`]: AUTOMATION_CHANNELS },
    },
    {
      sql: `${alias}.trigger_kind IN (:...${alias}AgentTriggers)`,
      params: { [`${alias}AgentTriggers`]: AUTOMATION_TRIGGERS },
    },
  ];
}

/** `agentRunClauses` on a query builder. */
export function whereAgentRun<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>, alias: string): SelectQueryBuilder<T> {
  for (const clause of agentRunClauses(alias)) {
    qb.andWhere(clause.sql, clause.params);
  }
  return qb;
}

export type RunOrigin = Pick<AiRun, 'invocation_channel' | 'trigger_kind' | 'user_id'>;

/**
 * A run a person started: the assistant's tools (`chat` / `human_user`), a write the person
 * approved in the conversation (`internal` / `human_user`), an MCP call (`mcp` / `mcp_client`).
 * A run that is not plainly an agent's counts as a person's.
 */
export function isPersonRun(run: Pick<RunOrigin, 'invocation_channel' | 'trigger_kind'>): boolean {
  return !(AUTOMATION_CHANNEL_SET.has(run.invocation_channel) && AUTOMATION_TRIGGER_SET.has(run.trigger_kind));
}

/**
 * The origin of what no run accounts for (an action whose run is unknown): its person's, as
 * nothing says an agent made it.
 */
export function originWithoutRun(userId: string | null | undefined): RunOrigin {
  return { invocation_channel: '', trigger_kind: '', user_id: userId ?? null };
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

/**
 * What the line of an action keeps of its metadata for a reader who does not read its result:
 * that somebody acknowledged it. The rest carries the arguments or what a failure said of them.
 */
export function actionMetadataWithoutValues(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const acknowledged = (metadata as Record<string, unknown>).attention_acknowledged;
  return acknowledged === undefined ? null : { attention_acknowledged: acknowledged };
}

const ACTION_LINE_KEYS = ['tool_name', 'preview_id', 'target_entity_type', 'target_entity_id', 'target_ref'] as const;

/**
 * What the line of an action keeps of its input for a reader who does not read its result: the
 * tool and the target it names.
 */
export function actionInputWithoutValues(inputSummary: unknown): Record<string, unknown> | null {
  if (!inputSummary || typeof inputSummary !== 'object' || Array.isArray(inputSummary)) return null;
  const kept: Record<string, unknown> = {};
  for (const key of ACTION_LINE_KEYS) {
    if (key in inputSummary) kept[key] = (inputSummary as Record<string, unknown>)[key];
  }
  return Object.keys(kept).length > 0 ? kept : null;
}
