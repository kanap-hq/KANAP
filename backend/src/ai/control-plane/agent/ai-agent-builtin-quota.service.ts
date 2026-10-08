import { ForbiddenException, Injectable } from '@nestjs/common';
import { AiExecutionContextWithManager } from '../../ai.types';
import { AiModelResolutionError, AiModelResolverService } from '../../ai-model-resolver.service';
import { AiBuiltinUsageService } from '../../platform/ai-builtin-usage.service';

export const AGENT_RUNS_AWAIT_BUILTIN_CONFIRMATION =
  'Agent runs are paused until an administrator confirms the KANAP included model in Admin > Plaid.';

type BuiltinUse = 'builtin' | 'awaiting_confirmation' | 'other';

// Agent runs on the built-in (free-volume) provider consume the same monthly message
// quota as Plaid chat: one triage run = one included message, reserved before the run
// does any provider or LLM work. Agents assigned (or defaulting to) a registry model
// are unlimited here — the tenant pays its own provider.
//
// The same two gates stop runs that would fall back on the included model before an
// administrator of the workspace has confirmed it: the scheduled poller pauses with
// that reason (queued items wait, nothing is consumed) and a run started by hand fails
// with it before any provider or LLM work.
@Injectable()
export class AiAgentBuiltinQuotaService {
  constructor(
    private readonly modelResolver: AiModelResolverService,
    private readonly builtinUsage: AiBuiltinUsageService,
  ) {}

  private async builtinUse(context: AiExecutionContextWithManager): Promise<BuiltinUse> {
    try {
      const resolved = await this.modelResolver.resolve(
        context.tenantId,
        context.agentId ? { type: 'agent', agentId: context.agentId } : { type: 'chat' },
        context.manager,
      );
      return resolved.source === 'builtin' ? 'builtin' : 'other';
    } catch (error) {
      if (error instanceof AiModelResolutionError) {
        return error.code === 'builtin_not_accepted' ? 'awaiting_confirmation' : 'other';
      }
      throw error;
    }
  }

  // Non-consuming gate for the scheduled poller: lets a cycle pause processing with an
  // honest reason instead of starting runs that would fail at reservation time.
  async assertQuotaAvailable(context: AiExecutionContextWithManager): Promise<void> {
    const use = await this.builtinUse(context);
    if (use === 'awaiting_confirmation') {
      throw new ForbiddenException(AGENT_RUNS_AWAIT_BUILTIN_CONFIRMATION);
    }
    if (use !== 'builtin') return;
    const usage = await this.builtinUsage.getCurrentUsage(context.tenantId, context.manager);
    if (usage.count >= usage.limit) {
      throw new ForbiddenException('The monthly volume of included AI messages is used up; agent runs resume when it resets.');
    }
  }

  async reserveRun(context: AiExecutionContextWithManager): Promise<void> {
    const use = await this.builtinUse(context);
    if (use === 'awaiting_confirmation') {
      throw new ForbiddenException(AGENT_RUNS_AWAIT_BUILTIN_CONFIRMATION);
    }
    if (use !== 'builtin') return;
    const limit = await this.builtinUsage.getMonthlyLimit(context.manager);
    // Detached on purpose: agent runs execute inside a transaction that stays open
    // across their LLM calls; reserving through context.manager would keep the
    // tenant's usage row locked for the whole run and stall every Plaid message.
    await this.builtinUsage.reserveMessageDetached(context.tenantId, limit);
  }
}
