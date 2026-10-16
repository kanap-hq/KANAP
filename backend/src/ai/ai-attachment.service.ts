import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { StorageService } from '../common/storage/storage.service';
import { fixMulterFilename, uploadedBytes } from '../common/upload';
import { validateUploadedFile } from '../common/upload-validation';
import { AiConversation } from './ai-conversation.entity';
import { AiMessageAttachment } from './ai-message-attachment.entity';

export type UploadAttachmentInput = {
  conversationId: string;
  tenantId: string;
  userId: string | null;
  file: Express.Multer.File;
};

@Injectable()
export class AiAttachmentService {
  constructor(
    private readonly storage: StorageService,
    @InjectRepository(AiMessageAttachment)
    private readonly attachmentsRepo: Repository<AiMessageAttachment>,
    @InjectRepository(AiConversation)
    private readonly conversationsRepo: Repository<AiConversation>,
  ) {}

  private getAttachmentRepo(manager?: EntityManager): Repository<AiMessageAttachment> {
    return manager ? manager.getRepository(AiMessageAttachment) : this.attachmentsRepo;
  }

  private getConversationRepo(manager?: EntityManager): Repository<AiConversation> {
    return manager ? manager.getRepository(AiConversation) : this.conversationsRepo;
  }

  /**
   * Upload an inline image for a Plaid chat conversation.
   *
   * Tenant safety:
   *   - Conversation lookup is filtered by both id AND tenant_id (defence in depth on top of RLS).
   *   - Storage path is prefixed by tenant_id so cross-tenant access via signed URL is impossible
   *     even if the access policy on the bucket somehow leaks.
   *   - The uploader must own (created) the conversation, otherwise we 403 — this prevents an
   *     attacker who guessed a conversation_id from injecting attachments.
   */
  async uploadInlineImage(input: UploadAttachmentInput, manager?: EntityManager): Promise<AiMessageAttachment> {
    if (!input.file) throw new BadRequestException('No file uploaded');

    const conversation = await this.getConversationRepo(manager).findOne({
      where: { id: input.conversationId, tenant_id: input.tenantId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.archived_at) throw new BadRequestException('Conversation is archived');
    if (input.userId && conversation.user_id !== input.userId) {
      throw new ForbiddenException('Cannot attach to another user\'s conversation');
    }

    const decodedName = fixMulterFilename(input.file.originalname);
    const ext = path.extname(decodedName || '') || '';

    const buf = uploadedBytes(input.file);

    const validated = validateUploadedFile(
      {
        originalName: decodedName,
        mimeType: input.file.mimetype,
        buffer: buf as Buffer,
        size: input.file.size,
      },
      { scope: 'inline-image' },
    );

    const id = randomUUID();
    const rand = Math.random().toString(36).slice(2, 8);
    const now = new Date();
    const key = [
      'files',
      input.tenantId,
      'ai',
      'conversations',
      input.conversationId,
      now.getUTCFullYear().toString(),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      `${id}_${rand}${ext}`,
    ].join('/');

    await this.storage.putObject({
      key,
      body: buf,
      contentType: validated.mimeType,
      contentLength: validated.size,
      sse: 'AES256',
    });

    const attachment = this.getAttachmentRepo(manager).create({
      id,
      tenant_id: input.tenantId,
      conversation_id: input.conversationId,
      message_id: null,
      uploaded_by_id: input.userId,
      original_filename: decodedName || `${id}${ext}`,
      stored_filename: path.basename(key),
      mime_type: validated.mimeType,
      size: validated.size,
      storage_path: key,
      kind: 'image',
    });

    return this.getAttachmentRepo(manager).save(attachment);
  }

  /**
   * Verify ownership of attachment ids and return the records. Throws if any id is missing
   * or doesn't belong to (tenantId, conversationId, userId).
   */
  async assertAndLoadAttachments(
    attachmentIds: string[],
    ctx: { conversationId: string; tenantId: string; userId: string | null },
    manager?: EntityManager,
  ): Promise<AiMessageAttachment[]> {
    if (!attachmentIds.length) return [];
    const rows = await this.getAttachmentRepo(manager).find({
      where: {
        id: In(attachmentIds),
        tenant_id: ctx.tenantId,
        conversation_id: ctx.conversationId,
      },
    });
    if (rows.length !== attachmentIds.length) {
      throw new BadRequestException('One or more attachments are invalid for this conversation');
    }
    if (ctx.userId) {
      for (const row of rows) {
        if (row.uploaded_by_id && row.uploaded_by_id !== ctx.userId) {
          throw new ForbiddenException('Attachment does not belong to current user');
        }
      }
    }
    // Preserve client-provided order so the LLM sees attachments in the user's intended order.
    const byId = new Map(rows.map((row) => [row.id, row]));
    return attachmentIds
      .map((id) => byId.get(id))
      .filter((row): row is AiMessageAttachment => Boolean(row));
  }

  /**
   * Link previously-uploaded attachments to a freshly-persisted message.
   * Idempotent: re-linking the same attachment twice is a no-op.
   */
  async linkAttachmentsToMessage(
    attachmentIds: string[],
    messageId: string,
    tenantId: string,
    manager?: EntityManager,
  ): Promise<void> {
    if (!attachmentIds.length) return;
    await this.getAttachmentRepo(manager)
      .createQueryBuilder()
      .update(AiMessageAttachment)
      .set({ message_id: messageId, linked_at: new Date() })
      .where('id IN (:...ids)', { ids: attachmentIds })
      .andWhere('tenant_id = :tenantId', { tenantId })
      .andWhere('message_id IS NULL')
      .execute();
  }

  /**
   * List attachments tied to a list of message ids. Used to hydrate stored conversations.
   */
  async listAttachmentsForMessages(
    messageIds: string[],
    tenantId: string,
    manager?: EntityManager,
  ): Promise<AiMessageAttachment[]> {
    if (!messageIds.length) return [];
    return this.getAttachmentRepo(manager).find({
      where: { message_id: In(messageIds), tenant_id: tenantId },
      order: { uploaded_at: 'ASC' },
    });
  }

  /**
   * Read a stored attachment as a buffer. Used for: (a) serving image bytes to the
   * frontend through a tenant-scoped GET endpoint, and (b) base64-encoding into the
   * multimodal content blocks sent to the LLM provider.
   */
  async loadAttachmentBuffer(
    attachmentId: string,
    tenantId: string,
    manager?: EntityManager,
  ): Promise<{ attachment: AiMessageAttachment; buffer: Buffer }> {
    const attachment = await this.getAttachmentRepo(manager).findOne({
      where: { id: attachmentId, tenant_id: tenantId },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');

    const obj = await this.storage.getObjectStream(attachment.storage_path);
    const chunks: Buffer[] = [];
    for await (const chunk of obj.stream as any) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return { attachment, buffer: Buffer.concat(chunks) };
  }
}
