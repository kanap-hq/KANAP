import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SkipTenantTransaction } from '../common/skip-tenant-transaction.decorator';
import { inlineImageMulterOptions } from '../common/upload';
import { AiAttachmentService } from './ai-attachment.service';
import { AiConversationService } from './ai-conversation.service';
import { AiMutationPreviewService } from './ai-mutation-preview.service';
import { AiPolicyService } from './ai-policy.service';
import { AiTenantExecutionService } from './execution/ai-tenant-execution.service';
import { AiExecutionContext } from './ai.types';
import { publicMessageUsage } from './ai-message-usage.util';

@Controller('ai/conversations')
@UseGuards(JwtAuthGuard)
@SkipTenantTransaction()
export class AiConversationsController {
  constructor(
    private readonly tenantExecutor: AiTenantExecutionService,
    private readonly policy: AiPolicyService,
    private readonly conversations: AiConversationService,
    private readonly previews: AiMutationPreviewService,
    private readonly attachments: AiAttachmentService,
  ) {}

  private buildContext(req: any): AiExecutionContext {
    return {
      tenantId: String(req?.tenant?.id || ''),
      userId: String(req?.user?.sub || ''),
      isPlatformHost: req?.isPlatformHost === true,
      surface: 'chat',
      authMethod: 'jwt',
      requestId: req?.id ?? null,
      aiApiKeyId: null,
    };
  }

  private parsePositiveInt(rawValue: string | undefined, field: string, defaultValue: number): number {
    if (rawValue == null || rawValue === '') {
      return defaultValue;
    }
    const value = Number(rawValue);
    if (!Number.isInteger(value) || value <= 0) {
      throw new BadRequestException(`${field} must be a positive integer.`);
    }
    return value;
  }

  @Get()
  async list(
    @Req() req: any,
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const context = this.buildContext(req);
    const page = this.parsePositiveInt(pageRaw, 'page', 1);
    const limit = Math.min(this.parsePositiveInt(limitRaw, 'limit', 100), 100);
    return this.tenantExecutor.runWithContext(context, async (ctx) => {
      await this.policy.assertSurfaceAccess(ctx, ctx.manager);
      const items = await this.conversations.listForUser(ctx.tenantId, ctx.userId, {
        manager: ctx.manager,
        page,
        limit,
      });
      return items.map((c) => ({
        id: c.id,
        title: c.title,
        provider: c.provider,
        model: c.model,
        created_at: c.created_at?.toISOString(),
        updated_at: c.updated_at?.toISOString(),
      }));
    });
  }

  /**
   * Create an empty conversation. Used when the frontend needs a conversation_id before
   * uploading attachments (since attachments are scoped to a conversation for tenant safety).
   * The conversation will be hydrated by the first /ai/chat/stream call.
   */
  @Post()
  async create(@Req() req: any) {
    const context = this.buildContext(req);
    return this.tenantExecutor.runWithContext(context, async (ctx) => {
      await this.policy.assertSurfaceAccess(ctx, ctx.manager);
      const conv = await this.conversations.createConversation(
        { tenantId: ctx.tenantId, userId: ctx.userId },
        { manager: ctx.manager },
      );
      return {
        id: conv.id,
        title: conv.title,
        provider: conv.provider,
        model: conv.model,
        created_at: conv.created_at?.toISOString(),
        updated_at: conv.updated_at?.toISOString(),
      };
    });
  }

  @Get(':id/messages')
  async getMessages(@Param('id') id: string, @Req() req: any) {
    const context = this.buildContext(req);
    return this.tenantExecutor.runWithContext(context, async (ctx) => {
      await this.policy.assertSurfaceAccess(ctx, ctx.manager);
      await this.conversations.getConversationForUser(id, ctx.tenantId, ctx.userId, {
        manager: ctx.manager,
      });
      const messages = await this.conversations.listMessagesForConversation(id, ctx.tenantId, {
        manager: ctx.manager,
      });
      const messageIds = messages.map((m) => m.id);
      const attachmentRows = await this.attachments.listAttachmentsForMessages(
        messageIds,
        ctx.tenantId,
        ctx.manager,
      );
      const attachmentsByMessageId = new Map<string, typeof attachmentRows>();
      for (const att of attachmentRows) {
        if (!att.message_id) continue;
        const list = attachmentsByMessageId.get(att.message_id) || [];
        list.push(att);
        attachmentsByMessageId.set(att.message_id, list);
      }
      const conversationUsage = await this.conversations.getConversationUsage(id, ctx.tenantId, {
        manager: ctx.manager,
      });
      return {
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          tool_calls: m.tool_calls,
          usage_json: publicMessageUsage(m.usage_json),
          created_at: m.created_at?.toISOString(),
          attachments: (attachmentsByMessageId.get(m.id) || []).map((a) => ({
            id: a.id,
            mime_type: a.mime_type,
            size: a.size,
            kind: a.kind,
          })),
        })),
        conversation_usage: conversationUsage,
      };
    });
  }

  @Get(':id/previews')
  async getPreviews(@Param('id') id: string, @Req() req: any) {
    const context = this.buildContext(req);
    return this.tenantExecutor.runWithContext(context, async (ctx) => {
      await this.policy.assertSurfaceAccess(ctx, ctx.manager);
      await this.conversations.getConversationForUser(id, ctx.tenantId, ctx.userId, {
        manager: ctx.manager,
      });
      return this.previews.listConversationPreviews(ctx, id);
    });
  }

  @Delete(':id')
  async archive(@Param('id') id: string, @Req() req: any) {
    const context = this.buildContext(req);
    return this.tenantExecutor.runWithContext(context, async (ctx) => {
      await this.policy.assertSurfaceAccess(ctx, ctx.manager);
      await this.conversations.archiveConversation(id, ctx.tenantId, ctx.userId, {
        manager: ctx.manager,
      });
      return { success: true };
    });
  }

  @Patch(':id')
  async rename(
    @Param('id') id: string,
    @Body() body: { title?: string },
    @Req() req: any,
  ) {
    const context = this.buildContext(req);
    return this.tenantExecutor.runWithContext(context, async (ctx) => {
      await this.policy.assertSurfaceAccess(ctx, ctx.manager);
      const conv = await this.conversations.renameConversation(
        id,
        ctx.tenantId,
        ctx.userId,
        body?.title ?? '',
        { manager: ctx.manager },
      );
      return {
        id: conv.id,
        title: conv.title,
        provider: conv.provider,
        model: conv.model,
        created_at: conv.created_at?.toISOString(),
        updated_at: conv.updated_at?.toISOString(),
      };
    });
  }

  /**
   * Upload an inline image for the given conversation. The attachment row starts with
   * message_id = NULL and is linked to the persisted ai_message when the user sends
   * the next chat stream call.
   */
  @Post(':id/attachments/inline')
  @UseInterceptors(FileInterceptor('file', inlineImageMulterOptions))
  async uploadInlineAttachment(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    const context = this.buildContext(req);
    return this.tenantExecutor.runWithContext(context, async (ctx) => {
      await this.policy.assertSurfaceAccess(ctx, ctx.manager);
      const attachment = await this.attachments.uploadInlineImage(
        {
          conversationId: id,
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          file,
        },
        ctx.manager,
      );
      return {
        id: attachment.id,
        conversation_id: attachment.conversation_id,
        mime_type: attachment.mime_type,
        size: attachment.size,
        kind: attachment.kind,
        original_filename: attachment.original_filename,
      };
    });
  }

  /**
   * Serve attachment bytes for in-app rendering. JWT-protected — frontend fetches and
   * converts to a blob URL. Tenant safety: storage path includes tenant_id, lookup
   * filters by tenant_id, and conversation ownership is verified.
   */
  @Get(':id/attachments/:attachmentId/inline')
  async viewInlineAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Req() req: any,
    @Res() res: Response,
  ): Promise<void> {
    const context = this.buildContext(req);
    await this.tenantExecutor.runWithContext(context, async (ctx) => {
      await this.policy.assertSurfaceAccess(ctx, ctx.manager);
      // Verify conversation belongs to user (defence in depth on top of RLS)
      await this.conversations.getConversationForUser(id, ctx.tenantId, ctx.userId, {
        manager: ctx.manager,
      });
      const { attachment, buffer } = await this.attachments.loadAttachmentBuffer(
        attachmentId,
        ctx.tenantId,
        ctx.manager,
      );
      if (attachment.conversation_id !== id) {
        throw new NotFoundException('Attachment not found');
      }
      res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream');
      res.setHeader('Content-Length', String(buffer.length));
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('Content-Disposition', 'inline');
      res.end(buffer);
    });
  }
}
