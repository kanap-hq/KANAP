import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AiExecutionContextWithManager } from '../../ai.types';
import { CapabilityContract, CapabilityEffect } from '../capability/capability-contract';
import { AiAgentDefinition } from '../entities/ai-agent-definition.entity';
import { AiEmergencyPause } from '../entities/ai-emergency-pause.entity';
import { codedForbidden } from '../../../auth/module-right-required';

export type AiPauseCheckInput = {
  capabilityName: string;
  category: string;
  effect: CapabilityEffect;
  agentDefinitionId?: string | null;
};

@Injectable()
export class AiEmergencyPauseService {
  constructor(
    @InjectRepository(AiEmergencyPause)
    private readonly pauseRepo: Repository<AiEmergencyPause>,
  ) {}

  private repo(manager: EntityManager) {
    return manager.getRepository(AiEmergencyPause);
  }

  async createPause(
    context: AiExecutionContextWithManager,
    input: {
      scope?: 'tenant' | 'agent' | 'global';
      agentDefinitionId?: string | null;
      capabilityName?: string | null;
      category?: string | null;
      effect?: string | null;
      reason: string;
      expiresAt?: Date | null;
    },
  ): Promise<AiEmergencyPause> {
    const scope = input.scope ?? 'tenant';
    if (scope === 'global') {
      throw codedForbidden('AGENT_PAUSE_NOT_ALLOWED', 'Global emergency pause mutation requires a platform control path.');
    }
    const agentDefinitionId = input.agentDefinitionId ?? null;
    if (scope === 'agent') {
      if (!agentDefinitionId) {
        throw codedForbidden('AGENT_PAUSE_NOT_ALLOWED', 'Agent emergency pause requires an agent definition.');
      }
      const definition = await context.manager.getRepository(AiAgentDefinition).findOne({
        where: { id: agentDefinitionId, tenant_id: context.tenantId },
      });
      if (!definition) {
        throw codedForbidden('AGENT_NOT_FOUND', 'Agent definition not found.');
      }
    } else if (agentDefinitionId) {
      throw codedForbidden('AGENT_PAUSE_NOT_ALLOWED', 'Only agent-scoped pauses may reference an agent definition.');
    }
    const repo = this.repo(context.manager);
    return repo.save(repo.create({
      tenant_id: context.tenantId,
      scope,
      agent_definition_id: scope === 'agent' ? agentDefinitionId : null,
      capability_name: input.capabilityName ?? null,
      category: input.category ?? null,
      effect: input.effect ?? null,
      active: true,
      reason: input.reason,
      actor_user_id: context.userId,
      actor_label: null,
      expires_at: input.expiresAt ?? null,
      revoked_at: null,
      created_at: new Date(),
    }));
  }

  async revokePause(
    context: AiExecutionContextWithManager,
    pauseId: string,
  ): Promise<AiEmergencyPause> {
    const repo = this.repo(context.manager);
    const pause = await repo.findOne({
      where: { id: pauseId, tenant_id: context.tenantId },
    });
    if (!pause) {
      throw codedForbidden('AGENT_PAUSE_NOT_FOUND', 'Emergency pause not found.');
    }
    pause.active = false;
    pause.revoked_at = new Date();
    return repo.save(pause);
  }

  async getPause(
    context: AiExecutionContextWithManager,
    pauseId: string,
  ): Promise<AiEmergencyPause | null> {
    return this.repo(context.manager).findOne({
      where: { id: pauseId, tenant_id: context.tenantId },
    });
  }

  async findActiveTenantWidePause(
    context: AiExecutionContextWithManager,
  ): Promise<AiEmergencyPause | null> {
    return this.repo(context.manager).createQueryBuilder('pause')
      .where('(pause.tenant_id = :tenantId OR pause.tenant_id IS NULL)', { tenantId: context.tenantId })
      .andWhere('pause.active = true')
      .andWhere('(pause.expires_at IS NULL OR pause.expires_at > now())')
      .andWhere('pause.agent_definition_id IS NULL')
      .andWhere("pause.scope IN ('tenant', 'global')")
      .orderBy('pause.created_at', 'DESC')
      .getOne();
  }

  async findActivePause(
    context: AiExecutionContextWithManager,
    input: AiPauseCheckInput,
  ): Promise<AiEmergencyPause | null> {
    const query = this.repo(context.manager).createQueryBuilder('pause')
      .where('(pause.tenant_id = :tenantId OR pause.tenant_id IS NULL)', { tenantId: context.tenantId })
      .andWhere('pause.active = true')
      .andWhere('(pause.expires_at IS NULL OR pause.expires_at > now())')
      .andWhere('(pause.capability_name IS NULL OR pause.capability_name = :capabilityName)', {
        capabilityName: input.capabilityName,
      })
      .andWhere('(pause.category IS NULL OR pause.category = :category)', {
        category: input.category,
      })
      .andWhere('(pause.effect IS NULL OR pause.effect = :effect)', {
        effect: input.effect,
      })
      .orderBy('pause.created_at', 'DESC');
    if (input.agentDefinitionId) {
      query.andWhere('(pause.agent_definition_id IS NULL OR pause.agent_definition_id = :agentDefinitionId)', {
        agentDefinitionId: input.agentDefinitionId,
      });
    } else {
      query.andWhere('pause.agent_definition_id IS NULL');
    }
    const rows = await query.getMany();
    return rows[0] ?? null;
  }

  async assertNotPaused(
    context: AiExecutionContextWithManager,
    contract: CapabilityContract,
    input: { agentDefinitionId?: string | null } = {},
  ): Promise<void> {
    const pause = await this.findActivePause(context, {
      capabilityName: contract.name,
      category: contract.category,
      effect: contract.effect,
      agentDefinitionId: input.agentDefinitionId ?? null,
    });
    if (pause) {
      throw codedForbidden('AI_EMERGENCY_PAUSE_ACTIVE', `AI emergency pause is active: ${pause.reason}`, { reason: pause.reason });
    }
  }
}
