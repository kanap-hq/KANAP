import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { Asset } from '../asset.entity';
import { AssetLink } from '../asset-link.entity';
import { AssetAttachment } from '../asset-attachment.entity';
import { AssetProject } from '../asset-project.entity';
import { PortfolioProject } from '../../portfolio/portfolio-project.entity';
import { AuditService } from '../../audit/audit.service';
import { StorageService } from '../../common/storage/storage.service';
import { unreferencedPaths } from '../../common/storage-path-refs';
import { AssetsBaseService, ServiceOpts } from './assets-base.service';
import { assertWebLinkUrl } from '../../common/web-link-url';
import { validateUploadedFile } from '../../common/upload-validation';
import { fixMulterFilename } from '../../common/upload';
import { replacedLinks } from '../../common/relations/linked-reads';
import { dateRecordMarkedMeanwhile, markLinkedEnds } from '../../common/relations/linked-ends';
import { appliedLinks, writeOwnerLinks, wroteLinks } from '../../portfolio/portfolio-link-writes.util';

/**
 * Service for managing asset links, attachments, and projects.
 */
const ASSET_PROJECT_LINKS = { table: 'asset_projects', owner: 'asset_id', target: 'project_id' };

@Injectable()
export class AssetsAttachmentsService extends AssetsBaseService {
  constructor(
    @InjectRepository(Asset) assetRepo: Repository<Asset>,
    @InjectRepository(AssetLink) private readonly linksRepo: Repository<AssetLink>,
    @InjectRepository(AssetAttachment) private readonly attachmentsRepo: Repository<AssetAttachment>,
    @InjectRepository(AssetProject) private readonly projectsRepo: Repository<AssetProject>,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {
    super(assetRepo);
  }

  // =========================================================================
  // Links (URLs)
  // =========================================================================

  /**
   * List links for an asset.
   */
  async listLinks(assetId: string, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const tenantId = this.ensureTenantId(opts?.tenantId);
    await this.ensureAsset(assetId, mg, tenantId);
    return mg.getRepository(AssetLink).find({
      where: { asset_id: assetId, tenant_id: tenantId } as any,
      order: { created_at: 'DESC' as any },
    });
  }

  /**
   * Create a link for an asset.
   */
  async createLink(assetId: string, body: Partial<AssetLink>, userId?: string | null, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const tenantId = this.ensureTenantId(opts?.tenantId);
    const asset = await this.ensureAsset(assetId, mg, tenantId);
    const repo = mg.getRepository(AssetLink);

    const url = assertWebLinkUrl(body.url);
    if (!url) throw new BadRequestException('url is required');
    const entity = repo.create({
      tenant_id: asset.tenant_id,
      asset_id: assetId,
      description: body.description ?? null,
      url,
    });

    const saved = await repo.save(entity);
    await this.audit.log(
      { table: 'asset_links', recordId: saved.id, action: 'create', before: null, after: saved, userId, ...this.auditSource(opts) },
      { manager: mg },
    );
    return saved;
  }

  /**
   * Update a link.
   */
  async updateLink(assetId: string, linkId: string, body: Partial<AssetLink>, userId?: string | null, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const tenantId = this.ensureTenantId(opts?.tenantId);
    const repo = mg.getRepository(AssetLink);

    const existing = await repo.findOne({ where: { id: linkId, asset_id: assetId, tenant_id: tenantId } as any });
    if (!existing) throw new NotFoundException('Link not found');

    const before = { ...existing };
    if (body.description !== undefined) existing.description = body.description as any;
    if (body.url !== undefined) existing.url = assertWebLinkUrl(body.url);

    const saved = await repo.save(existing);
    await this.audit.log(
      { table: 'asset_links', recordId: saved.id, action: 'update', before, after: saved, userId },
      { manager: mg },
    );
    return saved;
  }

  /**
   * Delete a link.
   */
  async deleteLink(assetId: string, linkId: string, userId?: string | null, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const tenantId = this.ensureTenantId(opts?.tenantId);
    const repo = mg.getRepository(AssetLink);

    const existing = await repo.findOne({ where: { id: linkId, asset_id: assetId, tenant_id: tenantId } as any });
    if (!existing) return { ok: true };

    await repo.delete({ id: linkId } as any);
    await this.audit.log(
      { table: 'asset_links', recordId: linkId, action: 'delete', before: existing, after: null, userId },
      { manager: mg },
    );
    return { ok: true };
  }

  // =========================================================================
  // Attachments
  // =========================================================================

  /**
   * List attachments for an asset.
   */
  async listAttachments(assetId: string, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const tenantId = this.ensureTenantId(opts?.tenantId);
    await this.ensureAsset(assetId, mg, tenantId);
    return mg.getRepository(AssetAttachment).find({
      where: { asset_id: assetId, tenant_id: tenantId } as any,
      order: { uploaded_at: 'DESC' as any },
    });
  }

  /**
   * Upload an attachment for an asset.
   */
  async uploadAttachment(assetId: string, file: Express.Multer.File, userId?: string | null, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const tenantId = this.ensureTenantId(opts?.tenantId);
    if (!file) throw new BadRequestException('No file uploaded');

    const asset = await this.ensureAsset(assetId, mg, tenantId);

    const buf = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer as any);
    if (!buf) throw new BadRequestException('Empty upload');
    const decodedName = fixMulterFilename(file.originalname);
    const validated = validateUploadedFile({
      originalName: decodedName,
      mimeType: (file as any).mimetype,
      buffer: buf as Buffer,
      size: (file as any).size,
    });
    const originalName = decodedName || `attachment${validated.extension}`;
    const storedSafe = `${randomUUID()}_${originalName}`;
    const keySafe = path.posix.join('files', asset.tenant_id, 'assets', assetId, storedSafe);

    await this.storage.putObject({
      key: keySafe,
      body: buf as Buffer,
      contentType: validated.mimeType,
      contentLength: validated.size,
      sse: 'AES256',
    });

    const repo = mg.getRepository(AssetAttachment);
    const saved = await repo.save(repo.create({
      tenant_id: asset.tenant_id,
      asset_id: assetId,
      original_filename: originalName,
      stored_filename: storedSafe,
      mime_type: validated.mimeType || null,
      size: validated.size,
      storage_path: keySafe,
    }));

    await this.audit.log(
      { table: 'asset_attachments', recordId: (saved as any).id, action: 'create', before: null, after: saved, userId },
      { manager: mg },
    );
    return saved;
  }

  /**
   * Get attachment metadata for download.
   */
  async downloadAttachment(attachmentId: string, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const tenantId = this.ensureTenantId(opts?.tenantId);
    const repo = mg.getRepository(AssetAttachment);

    const found = await repo.findOne({ where: { id: attachmentId, tenant_id: tenantId } as any });
    if (!found) throw new NotFoundException('Attachment not found');

    return found;
  }

  /**
   * Delete an attachment.
   */
  async deleteAttachment(attachmentId: string, userId?: string | null, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const tenantId = this.ensureTenantId(opts?.tenantId);
    const repo = mg.getRepository(AssetAttachment);

    const found = await repo.findOne({ where: { id: attachmentId, tenant_id: tenantId } as any });
    if (!found) return { ok: true };

    await repo.delete({ id: attachmentId, tenant_id: tenantId } as any);
    if ((await unreferencedPaths(mg, tenantId, [found.storage_path])).length > 0) {
      try {
        await this.storage.deleteObject(found.storage_path);
      } catch {}
    }

    await this.audit.log(
      { table: 'asset_attachments', recordId: found.id, action: 'delete', before: found, after: null, userId },
      { manager: mg },
    );
    return { ok: true };
  }

  // =========================================================================
  // Projects
  // =========================================================================

  /**
   * List projects linked to an asset.
   */
  async listProjects(assetId: string, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const tenantId = this.ensureTenantId(opts?.tenantId);
    await this.ensureAsset(assetId, mg, tenantId);

    const rows = await mg.query(
      `SELECT l.project_id as id, p.name
       FROM asset_projects l
       JOIN portfolio_projects p ON p.id = l.project_id
       WHERE l.asset_id = $1 AND l.tenant_id = $2 AND p.tenant_id = $2
       ORDER BY p.name ASC`,
      [assetId, tenantId],
    );
    return { items: rows };
  }

  /**
   * Bulk replace projects linked to an asset. The asset is locked first (FOR NO KEY UPDATE, as its
   * Relations tab does), so two replacements take turns and read the set the other committed. One
   * audit row on the asset when this call wrote a link (`asset_projects`, `{ ids }` before and
   * after, the tab's form), then one per project it reached (`common/relations/linked-ends.ts`).
   */
  async bulkReplaceProjects(
    assetId: string,
    projectIds: string[],
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts & { removable?: string[] },
  ) {
    const mg = this.getManager(opts);
    const tenant = this.ensureTenantId(tenantId);
    const asset = await this.ensureAsset(assetId, mg, tenant);

    const cleanIds = Array.from(new Set((projectIds || []).map((id) => String(id || '').trim().toLowerCase()).filter(Boolean)));
    if (cleanIds.length) {
      const projects = await mg.getRepository(PortfolioProject).find({
        where: { id: In(cleanIds), tenant_id: asset.tenant_id } as any,
      });
      if (projects.length !== cleanIds.length) throw new BadRequestException('One or more projects not found');
    }
    const locked: unknown[] = await mg.query(
      `SELECT 1 FROM assets WHERE tenant_id = $1 AND id = $2 FOR NO KEY UPDATE`,
      [asset.tenant_id, asset.id],
    );
    if (locked.length === 0) throw new NotFoundException('Asset not found');

    // Only the stored links the person may remove leave (`removable`); the others stay untouched.
    const existing: Array<{ id: string }> = await mg.query(
      `SELECT project_id::text AS id FROM asset_projects WHERE asset_id = $1 AND tenant_id = $2`,
      [asset.id, asset.tenant_id],
    );
    const beforeIds = existing.map((row) => row.id.toLowerCase()).sort();
    const { removed, added } = replacedLinks(beforeIds, cleanIds, opts?.removable);
    // Only what this call wrote counts: a link the project's side stored or removed meanwhile is
    // neither audited nor marked twice.
    const written = await writeOwnerLinks(mg, ASSET_PROJECT_LINKS, asset.tenant_id, asset.id, removed, added);
    if (wroteLinks(written)) {
      await this.audit.log({
        table: 'asset_projects',
        recordId: asset.id,
        action: 'update',
        before: { ids: beforeIds },
        after: { ids: appliedLinks(beforeIds, written) },
        userId,
      }, { manager: mg });
      await markLinkedEnds({
        manager: mg, audit: this.audit, table: 'asset_projects', end: 'project', from: asset.id, tenantId: asset.tenant_id,
        written, userId,
      });
    } else {
      // Nothing written: a project may have posted a link meanwhile, its dating skipping the asset
      // this replacement held (`common/relations/linked-ends.ts`).
      await dateRecordMarkedMeanwhile(mg, 'asset', asset.tenant_id, asset.id);
    }

    return this.listProjects(assetId, { manager: mg, tenantId: tenant });
  }
}
