import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { InterfaceEntity } from '../interface.entity';
import { InterfaceLeg } from '../interface-leg.entity';
import { InterfaceMiddlewareApplication } from '../interface-middleware-application.entity';
import { InterfaceAttachment } from '../interface-attachment.entity';
import { InterfaceBinding } from '../../interface-bindings/interface-binding.entity';
import { Application } from '../../applications/application.entity';
import { AuditService } from '../../audit/audit.service';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { StorageService } from '../../common/storage/storage.service';
import { unreferencedPaths } from '../../common/storage-path-refs';
import {
  InterfacesBaseService,
  ServiceOpts,
} from './interfaces-base.service';
import { validateUploadedFile } from '../../common/upload-validation';
import { fixMulterFilename } from '../../common/upload';

/**
 * Service for sync operations and attachments management.
 */
@Injectable()
export class InterfaceSyncService extends InterfacesBaseService {
  constructor(
    @InjectRepository(InterfaceEntity) repo: Repository<InterfaceEntity>,
    @InjectRepository(InterfaceLeg) legs: Repository<InterfaceLeg>,
    @InjectRepository(InterfaceMiddlewareApplication) middlewareApps: Repository<InterfaceMiddlewareApplication>,
    @InjectRepository(Application) apps: Repository<Application>,
    @InjectRepository(InterfaceBinding) bindings: Repository<InterfaceBinding>,
    itOpsSettings: ItOpsSettingsService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {
    super(repo, legs, middlewareApps, apps, bindings, itOpsSettings);
  }

  /**
   * List attachments for an interface.
   */
  async listAttachments(interfaceId: string, opts?: ServiceOpts) {
    const mg = opts?.manager ?? this.repo.manager;
    return mg.getRepository(InterfaceAttachment).find({
      where: { interface_id: interfaceId } as any,
      order: { uploaded_at: 'DESC' as any },
    });
  }

  /**
   * Upload an attachment for an interface.
   */
  async uploadAttachment(
    interfaceId: string,
    file: Express.Multer.File,
    body: any,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    if (!file) throw new BadRequestException('No file uploaded');
    const tenant_id = await this.resolveTenantId(mg);
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
    const stored = `${randomUUID()}_${originalName}`;
    const key = path.posix.join('files', tenant_id, 'interfaces', interfaceId, stored);
    await this.storage.putObject({
      key,
      body: buf as Buffer,
      contentType: validated.mimeType,
      contentLength: validated.size,
      sse: 'AES256',
    });
    const repo = mg.getRepository(InterfaceAttachment);
    const kindRaw = body?.kind;
    const kind = String(kindRaw || 'functional').trim() || 'functional';
    const saved = await repo.save(
      repo.create({
        interface_id: interfaceId,
        kind,
        original_filename: originalName,
        stored_filename: stored,
        mime_type: validated.mimeType || null,
        size: validated.size,
        storage_path: key,
      }),
    );
    await this.audit.log(
      { table: 'interface_attachments', recordId: (saved as any).id, action: 'create', before: null, after: saved, userId },
      { manager: mg },
    );
    return saved;
  }

  /**
   * Download an attachment for an interface.
   */
  async downloadAttachment(attachmentId: string, opts?: ServiceOpts) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(InterfaceAttachment);
    const found = await repo.findOne({ where: { id: attachmentId } });
    if (!found) throw new NotFoundException('Attachment not found');
    return found;
  }

  /**
   * Delete an attachment for an interface.
   */
  async deleteAttachment(
    attachmentId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const tenantId = await this.resolveTenantId(mg);
    const repo = mg.getRepository(InterfaceAttachment);
    const found = await repo.findOne({ where: { id: attachmentId, tenant_id: tenantId } });
    if (!found) return { ok: true };
    await repo.delete({ id: attachmentId, tenant_id: tenantId } as any);
    if ((await unreferencedPaths(mg, tenantId, [found.storage_path])).length > 0) {
      try {
        await this.storage.deleteObject(found.storage_path);
      } catch {
        // Best-effort; ignore storage errors during delete
      }
    }
    await this.audit.log(
      { table: 'interface_attachments', recordId: found.id, action: 'delete', before: found, after: null, userId },
      { manager: mg },
    );
    return { ok: true };
  }
}
