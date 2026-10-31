import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { llmCostEur } from './ai-llm-cost.util';
import { AiModelResolverService } from './ai-model-resolver.service';

export type AiAdminOverviewRecentActivityItem = {
  conversation_id: string;
  title: string | null;
  user_id: string | null;
  provider: string | null;
  model: string | null;
  updated_at: string;
};

export type AiAdminOverviewAgentUsage = {
  agent_definition_id: string;
  name: string;
  messages_current_month: number;
  messages_last_30_days: number;
};

export type AiAdminOverviewAgentCost = {
  agent_definition_id: string;
  name: string;
  cost_current_month_eur: number;
  cost_last_30_days_eur: number;
};

export type AiAdminOverviewModelCost = {
  model: string | null;
  cost_current_month_eur: number;
  cost_last_30_days_eur: number;
};

export type AiAdminOverviewCosts = {
  current_month: { agents_eur: number; chat_eur: number; total_eur: number };
  last_30_days: { agents_eur: number; chat_eur: number; total_eur: number };
  by_agent: AiAdminOverviewAgentCost[];
  by_model: AiAdminOverviewModelCost[];
  // Whether the currently assigned chat model has prices: false when none resolves
  // or its prices are 0/null.
  chat_priced: boolean;
  // The month's chat cost holds messages recorded without their own cost (written
  // before each message recorded it), estimated at the currently assigned model's
  // rates, and that estimate is not 0.
  chat_estimated: boolean;
};

export type AiAdminOverviewResponse = {
  totals: {
    conversations_all: number;
    conversations_7d: number;
    conversations_30d: number;
    active_users_30d: number;
  };
  usage: {
    current_month: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      message_count: number;
    };
    last_30_days: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      message_count: number;
    };
  };
  recent_activity: AiAdminOverviewRecentActivityItem[];
  agents: AiAdminOverviewAgentUsage[];
  costs: AiAdminOverviewCosts;
};

function toNumber(value: unknown): number {
  if (value == null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIsoDate(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return date.toISOString();
}

function roundCost(value: number): number {
  return Number(value.toFixed(6));
}

// One row per model: an agent row and a chat row of the same `provider:model` add up.
function mergeModelCosts(rows: Array<Record<string, unknown>>): AiAdminOverviewModelCost[] {
  const byModel = new Map<string | null, AiAdminOverviewModelCost>();
  for (const row of rows) {
    const model = row.model == null ? null : String(row.model);
    const current = byModel.get(model);
    const month = toNumber(row.cost_current_month_eur);
    const last30Days = toNumber(row.cost_last_30_days_eur);
    if (current) {
      current.cost_current_month_eur = roundCost(current.cost_current_month_eur + month);
      current.cost_last_30_days_eur = roundCost(current.cost_last_30_days_eur + last30Days);
    } else {
      byModel.set(model, { model, cost_current_month_eur: month, cost_last_30_days_eur: last30Days });
    }
  }
  return [...byModel.values()].sort((a, b) => b.cost_last_30_days_eur - a.cost_last_30_days_eur);
}

@Injectable()
export class AiAdminOverviewService {
  constructor(private readonly modelResolver: AiModelResolverService) {}

  async getOverview(
    tenantId: string,
    manager: EntityManager,
  ): Promise<AiAdminOverviewResponse> {
    const totalsRows = await manager.query(
      `
      SELECT
        COUNT(*)::bigint AS conversations_all,
        COUNT(*) FILTER (WHERE updated_at >= now() - interval '7 days')::bigint AS conversations_7d,
        COUNT(*) FILTER (WHERE updated_at >= now() - interval '30 days')::bigint AS conversations_30d,
        COUNT(DISTINCT user_id) FILTER (WHERE updated_at >= now() - interval '30 days')::bigint AS active_users_30d
      FROM ai_conversations
      WHERE tenant_id = $1
      `,
      [tenantId],
    );

    // Each window also splits the chat cost: the costs assistant messages recorded
    // (usage_json.cost_eur) and the tokens of older messages that carry none.
    // message_count deliberately counts only user-sent messages — the unit the free
    // volume charges — not every persisted row (assistant replies and tool results
    // would triple the number and make it impossible to relate to the quota).
    const currentMonthRows = await manager.query(
      `
      SELECT
        COALESCE(SUM(COALESCE((usage_json->>'input_tokens')::bigint, 0)), 0)::bigint AS input_tokens,
        COALESCE(SUM(COALESCE((usage_json->>'output_tokens')::bigint, 0)), 0)::bigint AS output_tokens,
        COUNT(*) FILTER (WHERE role = 'user')::bigint AS message_count,
        COALESCE(SUM((usage_json->>'cost_eur')::numeric) FILTER (WHERE usage_json ? 'cost_eur'), 0) AS recorded_cost_eur,
        COALESCE(SUM(COALESCE((usage_json->>'input_tokens')::bigint, 0)) FILTER (WHERE NOT COALESCE(usage_json ? 'cost_eur', false)), 0)::bigint AS unrecorded_input_tokens,
        COALESCE(SUM(COALESCE((usage_json->>'output_tokens')::bigint, 0)) FILTER (WHERE NOT COALESCE(usage_json ? 'cost_eur', false)), 0)::bigint AS unrecorded_output_tokens
      FROM ai_messages
      WHERE tenant_id = $1
        AND created_at >= date_trunc('month', now())
      `,
      [tenantId],
    );

    const last30DaysRows = await manager.query(
      `
      SELECT
        COALESCE(SUM(COALESCE((usage_json->>'input_tokens')::bigint, 0)), 0)::bigint AS input_tokens,
        COALESCE(SUM(COALESCE((usage_json->>'output_tokens')::bigint, 0)), 0)::bigint AS output_tokens,
        COUNT(*) FILTER (WHERE role = 'user')::bigint AS message_count,
        COALESCE(SUM((usage_json->>'cost_eur')::numeric) FILTER (WHERE usage_json ? 'cost_eur'), 0) AS recorded_cost_eur,
        COALESCE(SUM(COALESCE((usage_json->>'input_tokens')::bigint, 0)) FILTER (WHERE NOT COALESCE(usage_json ? 'cost_eur', false)), 0)::bigint AS unrecorded_input_tokens,
        COALESCE(SUM(COALESCE((usage_json->>'output_tokens')::bigint, 0)) FILTER (WHERE NOT COALESCE(usage_json ? 'cost_eur', false)), 0)::bigint AS unrecorded_output_tokens
      FROM ai_messages
      WHERE tenant_id = $1
        AND created_at >= now() - interval '30 days'
      `,
      [tenantId],
    );

    // One agent run = one AI message (the same unit the built-in quota counts). Runs
    // carry their agent in metadata_json; the join window uses LEAST(month start, 30
    // days ago) so the current-month count stays complete on the 31st of a month.
    const agentUsageRows = await manager.query(
      `
      SELECT
        d.id AS agent_definition_id,
        d.name,
        COUNT(r.id) FILTER (WHERE r.started_at >= date_trunc('month', now()))::bigint AS messages_current_month,
        COUNT(r.id)::bigint AS messages_last_30_days
      FROM ai_agent_definitions d
      LEFT JOIN ai_runs r
        ON r.tenant_id = $1
       AND r.metadata_json->>'agent_definition_id' = d.id::text
       AND r.started_at >= LEAST(date_trunc('month', now()), now() - interval '30 days')
      WHERE d.tenant_id = $1
        AND d.status != 'archived'
      GROUP BY d.id, d.name
      ORDER BY messages_last_30_days DESC, d.name ASC
      `,
      [tenantId],
    );

    // Real per-run costs recorded by the LLM stages (cost_json). The flattened
    // root estimated_cost_eur is the run-total ledger snapshot; the per-stage
    // objects carry {estimated_cost_eur, model}. The run total prefers the
    // snapshot and falls back to the stage sum, never both (no double count).
    const agentCostRows = await manager.query(
      `
      WITH run_costs AS (
        SELECT
          r.metadata_json->>'agent_definition_id' AS agent_definition_id,
          r.started_at,
          COALESCE(
            (r.cost_json->>'estimated_cost_eur')::numeric,
            (
              SELECT COALESCE(SUM((s.value->>'estimated_cost_eur')::numeric), 0)
              FROM jsonb_each(r.cost_json) s
              WHERE jsonb_typeof(s.value) = 'object' AND s.value ? 'estimated_cost_eur'
            ),
            0
          ) AS cost_eur
        FROM ai_runs r
        WHERE r.tenant_id = $1
          AND r.cost_json IS NOT NULL
          AND r.started_at >= LEAST(date_trunc('month', now()), now() - interval '30 days')
      )
      SELECT
        d.id AS agent_definition_id,
        d.name,
        COALESCE(SUM(c.cost_eur) FILTER (WHERE c.started_at >= date_trunc('month', now())), 0) AS cost_current_month_eur,
        COALESCE(SUM(c.cost_eur) FILTER (WHERE c.started_at >= now() - interval '30 days'), 0) AS cost_last_30_days_eur
      FROM ai_agent_definitions d
      JOIN run_costs c ON c.agent_definition_id = d.id::text
      WHERE d.tenant_id = $1
      GROUP BY d.id, d.name
      ORDER BY cost_last_30_days_eur DESC, d.name ASC
      `,
      [tenantId],
    );

    const modelCostRows = await manager.query(
      `
      SELECT
        s.value->>'model' AS model,
        COALESCE(SUM((s.value->>'estimated_cost_eur')::numeric) FILTER (WHERE r.started_at >= date_trunc('month', now())), 0) AS cost_current_month_eur,
        COALESCE(SUM((s.value->>'estimated_cost_eur')::numeric) FILTER (WHERE r.started_at >= now() - interval '30 days'), 0) AS cost_last_30_days_eur
      FROM ai_runs r
      CROSS JOIN LATERAL jsonb_each(r.cost_json) s
      WHERE r.tenant_id = $1
        AND r.cost_json IS NOT NULL
        AND r.started_at >= LEAST(date_trunc('month', now()), now() - interval '30 days')
        AND jsonb_typeof(s.value) = 'object'
        AND s.value ? 'estimated_cost_eur'
      GROUP BY s.value->>'model'
      ORDER BY cost_last_30_days_eur DESC
      `,
      [tenantId],
    );

    // Chat costs per model, from the messages that recorded their provider, model and
    // cost; the key is the agents' `provider:model` so both merge into one row.
    const chatModelCostRows = await manager.query(
      `
      SELECT
        (usage_json->>'provider') || ':' || (usage_json->>'model') AS model,
        COALESCE(SUM((usage_json->>'cost_eur')::numeric) FILTER (WHERE created_at >= date_trunc('month', now())), 0) AS cost_current_month_eur,
        COALESCE(SUM((usage_json->>'cost_eur')::numeric) FILTER (WHERE created_at >= now() - interval '30 days'), 0) AS cost_last_30_days_eur
      FROM ai_messages
      WHERE tenant_id = $1
        AND created_at >= LEAST(date_trunc('month', now()), now() - interval '30 days')
        AND usage_json ? 'cost_eur'
        AND usage_json ? 'provider'
        AND usage_json ? 'model'
      GROUP BY 1
      `,
      [tenantId],
    );

    const recentActivityRows = await manager.query(
      `
      SELECT
        id AS conversation_id,
        title,
        user_id,
        provider,
        model,
        updated_at
      FROM ai_conversations
      WHERE tenant_id = $1
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 10
      `,
      [tenantId],
    );

    const totals = totalsRows[0] ?? {};
    const currentMonth = currentMonthRows[0] ?? {};
    const last30Days = last30DaysRows[0] ?? {};

    // Chat cost: the costs the messages recorded, plus the older messages that carry
    // none, estimated at the currently assigned chat model's rates (the UI says when
    // part of the month is estimated).
    const chatModel = await this.modelResolver.tryResolve(tenantId, { type: 'chat' }, manager);
    const chatPrices = chatModel
      ? { priceInputEurPerMtok: chatModel.priceInputEurPerMtok, priceOutputEurPerMtok: chatModel.priceOutputEurPerMtok }
      : null;
    const estimatedChatMonth = llmCostEur(
      toNumber(currentMonth.unrecorded_input_tokens),
      toNumber(currentMonth.unrecorded_output_tokens),
      chatPrices,
    );
    const estimatedChat30d = llmCostEur(
      toNumber(last30Days.unrecorded_input_tokens),
      toNumber(last30Days.unrecorded_output_tokens),
      chatPrices,
    );
    const chatCostMonth = roundCost(toNumber(currentMonth.recorded_cost_eur) + estimatedChatMonth);
    const chatCost30d = roundCost(toNumber(last30Days.recorded_cost_eur) + estimatedChat30d);
    const agentsCostMonth = agentCostRows.reduce((sum: number, row: Record<string, unknown>) => sum + toNumber(row.cost_current_month_eur), 0);
    const agentsCost30d = agentCostRows.reduce((sum: number, row: Record<string, unknown>) => sum + toNumber(row.cost_last_30_days_eur), 0);

    return {
      totals: {
        conversations_all: toNumber(totals.conversations_all),
        conversations_7d: toNumber(totals.conversations_7d),
        conversations_30d: toNumber(totals.conversations_30d),
        active_users_30d: toNumber(totals.active_users_30d),
      },
      usage: {
        current_month: {
          input_tokens: toNumber(currentMonth.input_tokens),
          output_tokens: toNumber(currentMonth.output_tokens),
          total_tokens: toNumber(currentMonth.input_tokens) + toNumber(currentMonth.output_tokens),
          message_count: toNumber(currentMonth.message_count),
        },
        last_30_days: {
          input_tokens: toNumber(last30Days.input_tokens),
          output_tokens: toNumber(last30Days.output_tokens),
          total_tokens: toNumber(last30Days.input_tokens) + toNumber(last30Days.output_tokens),
          message_count: toNumber(last30Days.message_count),
        },
      },
      recent_activity: recentActivityRows.map((row: Record<string, unknown>) => ({
        conversation_id: String(row.conversation_id),
        title: row.title == null ? null : String(row.title),
        user_id: row.user_id == null ? null : String(row.user_id),
        provider: row.provider == null ? null : String(row.provider),
        model: row.model == null ? null : String(row.model),
        updated_at: toIsoDate(row.updated_at),
      })),
      agents: agentUsageRows.map((row: Record<string, unknown>) => ({
        agent_definition_id: String(row.agent_definition_id),
        name: String(row.name ?? ''),
        messages_current_month: toNumber(row.messages_current_month),
        messages_last_30_days: toNumber(row.messages_last_30_days),
      })),
      costs: {
        current_month: {
          agents_eur: Number(agentsCostMonth.toFixed(4)),
          chat_eur: chatCostMonth,
          total_eur: Number((agentsCostMonth + chatCostMonth).toFixed(4)),
        },
        last_30_days: {
          agents_eur: Number(agentsCost30d.toFixed(4)),
          chat_eur: chatCost30d,
          total_eur: Number((agentsCost30d + chatCost30d).toFixed(4)),
        },
        by_agent: agentCostRows.map((row: Record<string, unknown>) => ({
          agent_definition_id: String(row.agent_definition_id),
          name: String(row.name ?? ''),
          cost_current_month_eur: toNumber(row.cost_current_month_eur),
          cost_last_30_days_eur: toNumber(row.cost_last_30_days_eur),
        })),
        by_model: mergeModelCosts([...modelCostRows, ...chatModelCostRows]),
        chat_priced: !!chatPrices && ((chatPrices.priceInputEurPerMtok ?? 0) > 0 || (chatPrices.priceOutputEurPerMtok ?? 0) > 0),
        chat_estimated: estimatedChatMonth > 0,
      },
    };
  }
}
