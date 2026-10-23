import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { PortfolioProject } from '../portfolio-project.entity';
import { PortfolioProjectAttachment } from '../portfolio-project-attachment.entity';
import { AuditService } from '../../audit/audit.service';
import { StorageService } from '../../common/storage/storage.service';
import { PortfolioProjectsBaseService, ServiceOpts } from './portfolio-projects-base.service';
import { validateUploadedFile } from '../../common/upload-validation';
import { fixMulterFilename } from '../../common/upload';
import { extractInlineImageUrls } from '../../common/content-image-urls';
import { RemoteInlineImageImportService } from '../../common/remote-inline-image-import.service';
import { resolveInlineTenantSlug } from '../../common/resolve-inline-tenant-slug';
import { isStoragePathReferencedInAnyTable } from '../../common/storage-path-refs';
import { KnowledgeService } from '../../knowledge/knowledge.service';

/**
 * Service for managing project attachments.
 */
@Injectable()
export class PortfolioAttachmentsService extends PortfolioProjectsBaseService {
  constructor(
    @InjectRepository(PortfolioProject) projectRepo: Repository<PortfolioProject>,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly remoteInlineImages: RemoteInlineImageImportService,
    private readonly knowledge: KnowledgeService,
  ) {
    super(projectRepo);
  }

  /**
   * Upload an attachment for a project.
   */
  async uploadAttachment(
    projectId: string,
    file: Express.Multer.File,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);

    if (!file) throw new BadRequestException('No file uploaded');
    if (file.size > 20 * 1024 * 1024) {
      throw new BadRequestException('File size exceeds 20 MB limit');
    }

    const project = await this.ensureProject(projectId, mg);

    const buf = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer as any);
    const decodedName = fixMulterFilename(file.originalname);
    const validated = validateUploadedFile({
      originalName: decodedName,
      mimeType: file.mimetype,
      buffer: buf,
      size: file.size,
    });
    const originalName = decodedName || `attachment${validated.extension}`;
    const stored = `${randomUUID()}_${originalName}`;
    const key = path.posix.join(
      'files',
      project.tenant_id,
      'portfolio-projects',
      projectId,
      stored
    );

    await this.storage.putObject({
      key,
      body: buf,
      contentType: validated.mimeType,
      contentLength: validated.size,
      sse: 'AES256',
    });

    const repo = mg.getRepository(PortfolioProjectAttachment);
    const saved = await repo.save(repo.create({
      tenant_id: project.tenant_id,
      project_id: projectId,
      original_filename: originalName,
      stored_filename: stored,
      mime_type: validated.mimeType || null,
      size: validated.size,
      storage_path: key,
    }));

    await this.audit.log({
      table: 'portfolio_project_attachments',
      recordId: saved.id,
      action: 'create',
      before: null,
      after: saved,
      userId,
    }, { manager: mg });

    return saved;
  }

  /**
   * Delete an attachment.
   */
  async deleteAttachment(
    attachmentId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const repo = mg.getRepository(PortfolioProjectAttachment);

    const attachment = await repo.findOne({ where: { id: attachmentId } });
    if (!attachment) throw new NotFoundException('Attachment not found');

    try {
      await this.storage.deleteObject(attachment.storage_path);
    } catch (e) {
      // Log but don't fail
    }

    await repo.delete({ id: attachmentId });

    await this.audit.log({
      table: 'portfolio_project_attachments',
      recordId: attachmentId,
      action: 'delete',
      before: attachment,
      after: null,
      userId,
    }, { manager: mg });

    return { ok: true };
  }

  /**
   * Get attachment metadata.
   */
  async getAttachment(
    attachmentId: string,
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const repo = mg.getRepository(PortfolioProjectAttachment);

    const attachment = await repo.findOne({ where: { id: attachmentId } });
    if (!attachment) throw new NotFoundException('Attachment not found');

    return attachment;
  }

  /**
   * Upload inline attachment for rich text editor (images embedded in content).
   */
  async uploadInlineAttachment(
    projectId: string,
    file: Express.Multer.File,
    sourceField: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);

    if (!file) throw new BadRequestException('No file uploaded');
    if (file.size > 20 * 1024 * 1024) {
      throw new BadRequestException('File size exceeds 20 MB limit');
    }

    const project = await this.ensureProject(projectId, mg);

    const buf = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer as any);
    const decodedName = fixMulterFilename(file.originalname);
    const validated = validateUploadedFile({
      originalName: decodedName,
      mimeType: file.mimetype,
      buffer: buf,
      size: file.size,
    }, { scope: 'inline-image' });
    const originalName = decodedName || `image${validated.extension}`;
    const stored = `${randomUUID()}_${originalName}`;
    const key = path.posix.join(
      'files',
      project.tenant_id,
      'portfolio-projects',
      projectId,
      'inline',
      stored
    );

    await this.storage.putObject({
      key,
      body: buf,
      contentType: validated.mimeType,
      contentLength: validated.size,
      sse: 'AES256',
    });

    const repo = mg.getRepository(PortfolioProjectAttachment);
    const saved = await repo.save(repo.create({
      tenant_id: project.tenant_id,
      project_id: projectId,
      original_filename: originalName,
      stored_filename: stored,
      mime_type: validated.mimeType || null,
      size: validated.size,
      storage_path: key,
      source_field: sourceField,
    }));

    return saved;
  }

  async importInlineAttachmentFromUrl(
    projectId: string,
    sourceUrl: string,
    sourceField: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const file = await this.remoteInlineImages.importFromUrl(sourceUrl);
    return this.uploadInlineAttachment(projectId, file, sourceField, userId, opts);
  }

  /**
   * Get inline attachment metadata by tenant slug (for public access without JWT).
   * Sets RLS context using the tenant slug to validate access.
   */
  async getInlineAttachmentMeta(
    tenantSlug: string,
    attachmentId: string,
    refreshToken?: string | null,
  ): Promise<{ storagePath: string; mimeType: string | null; size: number | null } | null> {
    const effectiveSlug = resolveInlineTenantSlug(tenantSlug);
    const dataSource = this.projectRepo.manager.connection;
    const runner = dataSource.createQueryRunner();
    try {
      await runner.connect();
      await runner.startTransaction();

      // First get tenant ID from slug (tenants table typically has no RLS)
      const tenantRows = await runner.query(
        `SELECT id FROM tenants WHERE slug = $1 LIMIT 1`,
        [effectiveSlug],
      );
      if (!tenantRows.length) {
        await runner.rollbackTransaction();
        return null;
      }
      const tenantId = tenantRows[0].id;

      // Set the tenant context for RLS
      await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

      // Require the caller to be an authenticated tenant user with >= reader on portfolio_projects;
      // the attachment is then read under the person's data access (spec §6.3).
      const allowed = await this.knowledge.canAccessInlineAttachment(
        runner.manager, tenantId, refreshToken, 'portfolio_projects', { applyDataAccess: true },
      );
      // Only embedded images (source_field set) are served on this inline route.
      const rows = allowed
        ? await runner.query(
          `SELECT storage_path, mime_type, size FROM portfolio_project_attachments WHERE id = $1 AND source_field IS NOT NULL LIMIT 1`,
          [attachmentId],
        )
        : [];
      if (!rows.length) {
        await runner.rollbackTransaction();
        return null;
      }
      await runner.commitTransaction();

      return {
        storagePath: rows[0].storage_path,
        mimeType: rows[0].mime_type ?? null,
        size: rows[0].size ?? null,
      };
    } catch (err) {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }
      throw err;
    } finally {
      await runner.release();
    }
  }

  /**
   * Cleanup orphaned inline images when rich text content is updated.
   */
  async cleanupOrphanedImages(
    projectId: string,
    sourceField: string,
    oldContent: string | null,
    newContent: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const repo = mg.getRepository(PortfolioProjectAttachment);

    const oldUrls = extractInlineImageUrls(oldContent);
    const newUrls = new Set(extractInlineImageUrls(newContent));

    // Find URLs that were in old content but not in new content
    const removedUrls = oldUrls.filter(url => !newUrls.has(url));

    for (const url of removedUrls) {
      // Extract attachment ID from URL (pattern: /inline/{tenantSlug}/{attachmentId})
      const match = url.match(/\/inline\/[^/]+\/([a-f0-9-]+)\/?(?:\?.*)?$/i);
      if (match) {
        const attachmentId = match[1];
        try {
          const attachment = await repo.findOne({
            where: { id: attachmentId, project_id: projectId, source_field: sourceField },
          });
          if (attachment) {
            const referenced = await isStoragePathReferencedInAnyTable(mg, attachment.storage_path, [attachment.id]);
            await repo.delete({ id: attachmentId });
            if (!referenced) {
              try { await this.storage.deleteObject(attachment.storage_path); } catch {}
            }
          }
        } catch {
          // Ignore errors - image may have already been deleted
        }
      }
    }
  }
}
