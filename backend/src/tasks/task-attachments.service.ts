import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { TaskAttachment } from './task-attachment.entity';
import { StorageService } from '../common/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { validateUploadedFile } from '../common/upload-validation';
import { fixMulterFilename } from '../common/upload';
import { RemoteInlineImageImportService } from '../common/remote-inline-image-import.service';
import { DocumentImportService, ImportedDocumentResult } from '../common/document-import.service';
import { extractInlineImageUrls } from '../common/content-image-urls';
import { ImportExecutionOptions, readUploadedFileBuffer } from '../common/import-connection';
import { assertMarkdownSize } from '../common/markdown-limits';

@Injectable()
export class TaskAttachmentsService {
  constructor(
    @InjectRepository(TaskAttachment)
    private readonly repo: Repository<TaskAttachment>,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly remoteInlineImages: RemoteInlineImageImportService,
    private readonly importService: DocumentImportService,
  ) {}

  async listAttachments(taskId: string, opts?: { manager?: EntityManager }): Promise<TaskAttachment[]> {
    const mg = opts?.manager ?? this.repo.manager;
    const attachRepo = mg.getRepository(TaskAttachment);
    // Exclude inline images (source_field IS NOT NULL) - they're managed via rich text editor
    return attachRepo
      .createQueryBuilder('a')
      .where('a.task_id = :taskId', { taskId })
      .andWhere('a.source_field IS NULL')
      .orderBy('a.uploaded_at', 'DESC')
      .getMany();
  }

  async uploadAttachment(
    taskId: string,
    file: Express.Multer.File,
    userId?: string,
    opts?: { manager?: EntityManager; sourceField?: string | null },
  ): Promise<TaskAttachment> {
    const mg = opts?.manager ?? this.repo.manager;
    const attachRepo = mg.getRepository(TaskAttachment);

    if (!file) throw new BadRequestException('No file uploaded');

    const [{ tenant_id }] = await mg.query(`SELECT app_current_tenant() AS tenant_id`);
    const id = randomUUID();
    const now = new Date();
    const decodedName = fixMulterFilename(file.originalname);
    const ext = path.extname(decodedName || '') || '';
    const rand = Math.random().toString(36).slice(2, 8);
    const key = [
      'files', tenant_id, 'tasks', taskId,
      now.getUTCFullYear().toString(),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      `${id}_${rand}${ext}`,
    ].join('/');

    const buf = file.buffer ?? ((file as any).path ? fs.readFileSync((file as any).path) : null);
    if (!buf) throw new BadRequestException('Empty upload');
    const validated = validateUploadedFile({
      originalName: decodedName,
      mimeType: file.mimetype,
      buffer: buf as Buffer,
      size: file.size,
    }, { scope: opts?.sourceField ? 'inline-image' : 'attachment' });

    await this.storage.putObject({
      key,
      body: buf,
      contentType: validated.mimeType,
      contentLength: validated.size,
      sse: 'AES256',
    });

    const attachment = attachRepo.create({
      id,
      tenant_id,
      task_id: taskId,
      original_filename: decodedName || `${id}${ext}`,
      stored_filename: path.basename(key),
      mime_type: validated.mimeType as any,
      size: validated.size,
      storage_path: key,
      source_field: opts?.sourceField || null,
      uploaded_by_id: userId || null,
    });

    const saved = await attachRepo.save(attachment as any);
    await this.audit.log(
      { table: 'task_attachments', recordId: saved.id, action: 'create', before: null, after: saved, userId },
      { manager: mg },
    );
    return saved;
  }

  async getAttachment(
    attachmentId: string,
    opts?: { manager?: EntityManager },
  ): Promise<TaskAttachment> {
    const mg = opts?.manager ?? this.repo.manager;
    const attachRepo = mg.getRepository(TaskAttachment);
    const found = await attachRepo.findOne({ where: { id: attachmentId } });
    if (!found) throw new NotFoundException('Attachment not found');
    return found;
  }

  async importInlineAttachmentFromUrl(
    taskId: string,
    sourceUrl: string,
    userId?: string | null,
    opts?: { manager?: EntityManager; sourceField?: string | null },
  ): Promise<TaskAttachment> {
    const file = await this.remoteInlineImages.importFromUrl(sourceUrl);
    return this.uploadAttachment(taskId, file, userId || undefined, opts);
  }

  async importDocument(
    taskId: string,
    file: Express.Multer.File,
    userId?: string | null,
    opts?: ImportExecutionOptions & { sourceField?: string | null },
  ): Promise<{ markdown: string; warnings: string[] }> {
    const sourceField = String(opts?.sourceField || '').trim() || 'description';
    const buffer = readUploadedFileBuffer(file);
    let manager = opts?.manager ?? this.repo.manager;
    let converted: ImportedDocumentResult;
    if (opts?.releaseConnection) {
      const released = await opts.releaseConnection(
        () => this.importService.convertToMarkdown(buffer, file.mimetype, file.originalname),
      );
      converted = released.result;
      manager = released.manager;
    } else {
      converted = await this.importService.convertToMarkdown(
        buffer,
        file.mimetype,
        file.originalname,
      );
    }

    // Checked before the images are stored: the description could not be saved anyway.
    assertMarkdownSize(converted.markdown, sourceField);

    const tenantSlug = await this.loadCurrentTenantSlug(manager);
    const replacements = new Map<string, string>();
    for (const image of converted.images) {
      const attachment = await this.uploadAttachment(taskId, image.file, userId || undefined, {
        manager,
        sourceField,
      });
      replacements.set(image.sourcePath, this.buildInlineAttachmentPath(tenantSlug, attachment.id));
    }

    return {
      markdown: await this.importService.rewriteImageTargets(converted.markdown, replacements, converted.omittedTargets),
      warnings: converted.warnings,
    };
  }

  async cleanupOrphanedImages(
    taskId: string,
    sourceField: string,
    oldContent: string | null,
    newContent: string | null,
    opts?: { manager?: EntityManager },
  ): Promise<void> {
    const mg = opts?.manager ?? this.repo.manager;
    const attachRepo = mg.getRepository(TaskAttachment);
    const oldUrls = extractInlineImageUrls(oldContent);
    const newUrls = new Set(extractInlineImageUrls(newContent));

    for (const url of oldUrls) {
      if (newUrls.has(url)) {
        continue;
      }
      const match = url.match(/\/tasks\/attachments\/[^/]+\/([a-f0-9-]+)\/inline(?:[/?#].*)?$/i);
      if (!match) {
        continue;
      }
      const attachment = await attachRepo.findOne({
        where: { id: match[1], task_id: taskId, source_field: sourceField },
      });
      if (!attachment) {
        continue;
      }

      const refs = await mg.query<Array<{ exists: number }>>(
        `SELECT 1 AS exists
         FROM task_attachments
         WHERE storage_path = $1
           AND id <> $2
         LIMIT 1`,
        [attachment.storage_path, attachment.id],
      );
      if (refs.length === 0) {
        try {
          await this.storage.deleteObject(attachment.storage_path);
        } catch {
          // Ignore storage errors during delete.
        }
      }

      await attachRepo.delete({ id: attachment.id });
    }
  }

  async deleteAttachment(
    attachmentId: string,
    userId?: string,
    opts?: { manager?: EntityManager },
  ): Promise<{ ok: boolean }> {
    const mg = opts?.manager ?? this.repo.manager;
    const attachRepo = mg.getRepository(TaskAttachment);
    const found = await attachRepo.findOne({ where: { id: attachmentId } });
    if (!found) throw new NotFoundException('Attachment not found');

    const refs = await mg.query<Array<{ exists: number }>>(
      `SELECT 1 AS exists
       FROM task_attachments
       WHERE storage_path = $1
         AND id <> $2
       LIMIT 1`,
      [found.storage_path, found.id],
    );
    if (refs.length === 0) {
      try {
        await this.storage.deleteObject(found.storage_path);
      } catch {
        // Ignore storage errors during delete
      }
    }

    await attachRepo.remove(found);
    await this.audit.log(
      { table: 'task_attachments', recordId: found.id, action: 'delete', before: found, after: null, userId },
      { manager: mg },
    );
    return { ok: true };
  }

  private async loadCurrentTenantSlug(manager: EntityManager): Promise<string> {
    const currentTenantRows = await manager.query<Array<{ tenant_id: string | null }>>(
      'SELECT app_current_tenant() AS tenant_id',
    );
    const tenantId = String(currentTenantRows[0]?.tenant_id || '').trim();
    if (!tenantId) {
      throw new BadRequestException('Tenant context is required');
    }

    const tenantRows = await manager.query<Array<{ slug: string | null }>>(
      `SELECT slug
       FROM tenants
       WHERE id = $1
       LIMIT 1`,
      [tenantId],
    );
    const tenantSlug = String(tenantRows[0]?.slug || '').trim();
    return tenantSlug || tenantId;
  }

  private buildInlineAttachmentPath(tenantSlug: string, attachmentId: string): string {
    return `/api/tasks/attachments/${tenantSlug}/${attachmentId}/inline`;
  }
}
