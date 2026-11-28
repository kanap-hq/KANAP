import { resolveChatProviderTimeoutMs } from './ai-chat-orchestrator.service';
import { parsePositiveIntEnv } from './control-plane/agent-control/ai-agent-llm-client';

/** The default every agent stage passes when its variable is empty or invalid. */
export const AGENT_STAGE_DEFAULT_TIMEOUT_MS = 120_000;

/** The variable each agent stage reads at call time, for a model without a timeout of its own, read by its name. */
function agentStageTimeoutValues(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  return {
    AI_AGENT_ACTION_PLANNER_TIMEOUT_MS: env.AI_AGENT_ACTION_PLANNER_TIMEOUT_MS,
    AI_AGENT_DIAGNOSTIC_BRIEF_TIMEOUT_MS: env.AI_AGENT_DIAGNOSTIC_BRIEF_TIMEOUT_MS,
    AI_AGENT_KNOWLEDGE_LLM_TIMEOUT_MS: env.AI_AGENT_KNOWLEDGE_LLM_TIMEOUT_MS,
    AI_AGENT_REPLY_SYNTHESIS_TIMEOUT_MS: env.AI_AGENT_REPLY_SYNTHESIS_TIMEOUT_MS,
    AI_AGENT_VISION_EXTRACTION_TIMEOUT_MS: env.AI_AGENT_VISION_EXTRACTION_TIMEOUT_MS,
  };
}

/** The names of those variables. */
export const AGENT_STAGE_TIMEOUT_ENV_NAMES: readonly string[] = Object.keys(agentStageTimeoutValues({}));

/** The limits that apply to a model without a timeout of its own: the assistant's, and the agent stages' range. */
export type AppliedModelTimeouts = {
  chat_ms: number;
  agent_ms_min: number;
  agent_ms_max: number;
};

/** Read with the parsers of the calls themselves, so the page shows what applies now. */
export function appliedModelTimeouts(env: NodeJS.ProcessEnv = process.env): AppliedModelTimeouts {
  const agents = Object.values(agentStageTimeoutValues(env))
    .map((value) => parsePositiveIntEnv(value, AGENT_STAGE_DEFAULT_TIMEOUT_MS));
  return {
    chat_ms: resolveChatProviderTimeoutMs(env.AI_CHAT_PROVIDER_TIMEOUT_MS),
    agent_ms_min: Math.min(...agents),
    agent_ms_max: Math.max(...agents),
  };
}
