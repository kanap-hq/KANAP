import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Not, Repository } from 'typeorm';
import { AiConversation } from './ai-conversation.entity';
import { AiMessage } from './ai-message.entity';
import { USAGE_ONLY_MESSAGE_ROLE } from './ai-message-usage.util';
import { AiTokenUsage } from './ai.types';

export type CreateAiConversationInput = {
  tenantId: string;
  userId: string;
  title?: string | null;
  provider?: string | null;
  model?: string | null;
  providerSource?: 'builtin' | 'custom' | null;
};

export type AppendAiMessageInput = {
  conversationId: string;
  tenantId: string;
  conversationUserId: string;
  userId?: string | null;
  role: string;
  content: string;
  toolCalls?: Record<string, unknown>[] | null;
  usage?: Record<string, unknown> | null;
  providerMetadata?: Record<string, unknown> | null;
};

function toUsage(value: unknown): AiTokenUsage {
  if (!value || typeof value !== 'object') {
    return {
      input_tokens: 0,
      output_tokens: 0,
    };
  }

  const row = value as Record<string, unknown>;
  const inputTokens = Number(row.input_tokens);
  const outputTokens = Number(row.output_tokens);

  return {
    input_tokens: Number.isFinite(inputTokens) ? inputTokens : 0,
    output_tokens: Number.isFinite(outputTokens) ? outputTokens : 0,
  };
}

@Injectable()
export class AiConversationService {
  constructor(
    @InjectRepository(AiConversation)
    private readonly conversationRepo: Repository<AiConversation>,
    @InjectRepository(AiMessage)
    private readonly messageRepo: Repository<AiMessage>,
  ) {}

  private getConversationRepo(manager?: EntityManager) {
    return (manager ?? this.conversationRepo.manager).getRepository(AiConversation);
  }

  private getMessageRepo(manager?: EntityManager) {
    return (manager ?? this.messageRepo.manager).getRepository(AiMessage);
  }

  /**
   * Delete the message with the given id and every message that came after it in the
   * same conversation. Used by edit/regenerate flows: the orchestrator wipes the tail
   * of the conversation before streaming a fresh turn so the LLM doesn't see the old
   * (now-stale) replies in its replay history.
   *
   * Returns the number of rows deleted. Tenant + conversation FK are explicit on the
   * delete query so a stray id from another conversation can't cascade-wipe data.
   */
  async deleteMessagesFromInclusive(
    conversationId: string,
    tenantId: string,
    messageId: string,
    opts?: { manager?: EntityManager },
  ): Promise<number> {
    const repo = this.getMessageRepo(opts?.manager);
    const target = await repo.findOne({
      where: { id: messageId, tenant_id: tenantId, conversation_id: conversationId },
    });
    if (!target) {
      // Surface this loudly: the orchestrator was asked to truncate from a message
      // that doesn't exist in this (tenant, conversation). Failing silently here lets
      // a subtle bug (eg. the frontend sending a stale local- id) cascade into Plaid
      // replying as if the conversation hadn't been edited at all, or the LLM
      // receiving an assistant-message tail that triggers prefill errors.
      throw new NotFoundException('Cannot truncate: target message not found in this conversation.');
    }
    const result = await repo
      .createQueryBuilder()
      .delete()
      .from(AiMessage)
      .where('tenant_id = :tenantId', { tenantId })
      .andWhere('conversation_id = :conversationId', { conversationId })
      .andWhere('created_at >= :anchor', { anchor: target.created_at })
      .execute();
    return result.affected ?? 0;
  }

  /**
   * Set conversation.title if it is currently null/empty. Used to auto-title a
   * conversation that was first created empty (via POST /ai/conversations) and gets
   * its first user message later. No-op if a title is already set, so the user can
   * rename without us clobbering their value on the next send.
   */
  async setTitleIfMissing(
    conversationId: string,
    tenantId: string,
    title: string,
    opts?: { manager?: EntityManager },
  ): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed) return;
    await this.getConversationRepo(opts?.manager)
      .createQueryBuilder()
      .update(AiConversation)
      .set({ title: trimmed })
      .where('id = :id', { id: conversationId })
      .andWhere('tenant_id = :tenantId', { tenantId })
      .andWhere('(title IS NULL OR title = :empty)', { empty: '' })
      .execute();
  }

  createConversation(input: CreateAiConversationInput, opts?: { manager?: EntityManager }) {
    const repo = this.getConversationRepo(opts?.manager);
    return repo.save(repo.create({
      tenant_id: input.tenantId,
      user_id: input.userId,
      title: input.title?.trim() || null,
      provider: input.provider ?? null,
      model: input.model ?? null,
      provider_source: input.providerSource ?? null,
    }));
  }

  async listForUser(
    tenantId: string,
    userId: string,
    opts?: { manager?: EntityManager; page?: number; limit?: number },
  ) {
    const page = Math.max(1, Number(opts?.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(opts?.limit) || 100));
    const skip = (page - 1) * limit;

    return this.getConversationRepo(opts?.manager).find({
      where: {
        tenant_id: tenantId,
        user_id: userId,
        archived_at: IsNull(),
      },
      order: { updated_at: 'DESC' },
      skip,
      take: limit,
    });
  }

  async getConversationForTenant(
    id: string,
    tenantId: string,
    opts?: { manager?: EntityManager },
  ) {
    const conversation = await this.getConversationRepo(opts?.manager).findOne({
      where: {
        id,
        tenant_id: tenantId,
      },
    });
    if (!conversation) {
      throw new NotFoundException('AI conversation not found.');
    }
    return conversation;
  }

  async getConversationForUser(
    id: string,
    tenantId: string,
    userId: string,
    opts?: { manager?: EntityManager },
  ) {
    const conversation = await this.getConversationRepo(opts?.manager).findOne({
      where: {
        id,
        tenant_id: tenantId,
        user_id: userId,
      },
    });
    if (!conversation) {
      throw new NotFoundException('AI conversation not found.');
    }
    return conversation;
  }

  async listMessagesForConversation(
    conversationId: string,
    tenantId: string,
    opts?: { manager?: EntityManager },
  ) {
    return this.getMessageRepo(opts?.manager).find({
      where: { conversation_id: conversationId, tenant_id: tenantId, role: Not(USAGE_ONLY_MESSAGE_ROLE) },
      order: { created_at: 'ASC' },
    });
  }

  async listMessagesForUser(
    conversationId: string,
    tenantId: string,
    userId: string,
    opts?: { manager?: EntityManager },
  ) {
    await this.getConversationForUser(conversationId, tenantId, userId, opts);
    return this.listMessagesForConversation(conversationId, tenantId, opts);
  }

  async getConversationUsage(
    conversationId: string,
    tenantId: string,
    opts?: { manager?: EntityManager },
  ): Promise<AiTokenUsage> {
    const row = await this.getMessageRepo(opts?.manager)
      .createQueryBuilder('m')
      .select(
        "COALESCE(SUM(COALESCE((m.usage_json->>'input_tokens')::bigint, 0)), 0)::bigint",
        'input_tokens',
      )
      .addSelect(
        "COALESCE(SUM(COALESCE((m.usage_json->>'output_tokens')::bigint, 0)), 0)::bigint",
        'output_tokens',
      )
      .where('m.conversation_id = :conversationId', { conversationId })
      .andWhere('m.tenant_id = :tenantId', { tenantId })
      .getRawOne();

    return toUsage(row);
  }

  async archiveConversation(
    id: string,
    tenantId: string,
    userId: string,
    opts?: { manager?: EntityManager },
  ) {
    const repo = this.getConversationRepo(opts?.manager);
    const conversation = await repo.findOne({
      where: {
        id,
        tenant_id: tenantId,
        user_id: userId,
      },
    });
    if (!conversation) {
      throw new NotFoundException('AI conversation not found.');
    }
    conversation.archived_at = new Date();
    return repo.save(conversation);
  }

  async renameConversation(
    id: string,
    tenantId: string,
    userId: string,
    title: string,
    opts?: { manager?: EntityManager },
  ) {
    const trimmed = String(title || '').replace(/\s+/g, ' ').trim();
    if (!trimmed) {
      throw new BadRequestException('Conversation title is required.');
    }
    if (trimmed.length > 160) {
      throw new BadRequestException('Conversation title must be 160 characters or fewer.');
    }

    const repo = this.getConversationRepo(opts?.manager);
    const conversation = await repo.findOne({
      where: {
        id,
        tenant_id: tenantId,
        user_id: userId,
        archived_at: IsNull(),
      },
    });
    if (!conversation) {
      throw new NotFoundException('AI conversation not found.');
    }

    conversation.title = trimmed;
    conversation.updated_at = new Date();
    return repo.save(conversation);
  }

  async appendMessage(input: AppendAiMessageInput, opts?: { manager?: EntityManager }) {
    const conversationRepo = this.getConversationRepo(opts?.manager);
    const messageRepo = this.getMessageRepo(opts?.manager);
    const conversation = await conversationRepo.findOne({
      where: {
        id: input.conversationId,
        tenant_id: input.tenantId,
        user_id: input.conversationUserId,
        archived_at: IsNull(),
      },
    });
    if (!conversation) {
      throw new NotFoundException('AI conversation not found.');
    }

    const message = await messageRepo.save(messageRepo.create({
      conversation_id: input.conversationId,
      tenant_id: input.tenantId,
      user_id: input.userId ?? null,
      role: input.role,
      content: input.content,
      tool_calls: input.toolCalls ?? null,
      usage_json: input.usage ?? null,
      provider_metadata_json: input.providerMetadata ?? null,
    }));

    conversation.updated_at = new Date();
    await conversationRepo.save(conversation);

    return message;
  }
}
