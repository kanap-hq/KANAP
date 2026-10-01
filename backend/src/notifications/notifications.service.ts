import { Features } from '../config/features';
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import { EmailAttachment, EmailService } from '../email/email.service';
import { StorageService } from '../common/storage/storage.service';
import { resolveNotificationBaseUrl } from '../common/url';
import { withTenant } from '../common/tenant-runner';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationPreferencesData, WorkspaceSettings } from './notifications.constants';
import {
  ActionButton,
  buildStatusChangeEmail,
  buildStatusChangeWithCommentEmail,
  buildTeamAddedEmail,
  buildTeamMemberAddedEmail,
  buildCommentEmail,
  buildShareEmail,
  buildTaskAssignedEmail,
  buildExpirationWarningEmail,
  EmailContent,
  buildSsoUserProvisionedEmail,
} from './notification-templates';
import { renderCommentForEmail } from './comment-email-renderer';
import { renderMarkdownToHtml } from '../common/markdown-to-html';
import { EmailBranding, resolveEmailBranding } from '../email/email-branding';
import { getEmailStrings, resolveEmailLocale } from '../i18n/email-i18n';

type ItemType = 'request' | 'project' | 'task' | 'contract' | 'opex' | 'capex' | 'asset' | 'application' | 'location' | 'connection' | 'interface' | 'document';
type TriggerType = 'status_change' | 'team_added' | 'team_change_as_lead' | 'comment' | 'assignment' | 'expiration_warning';

/**
 * First key of the expiry claim's two-key advisory lock (the second is the
 * tenant and item). PostgreSQL keeps two-key locks apart from the single-key
 * `hashtext(...)` locks the scheduler and Netbox hold for a whole run, so a
 * claim can never wait on its own run's lock. No other two-key lock uses this
 * value ('EXPR' in ASCII).
 */
const EXPIRY_REMINDER_LOCK_NAMESPACE = 0x45585052;

interface NotificationRecipient {
  userId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  locale?: string | null;
}

interface AttachmentMeta {
  storagePath: string;
  mimeType: string | null;
  originalFilename: string | null;
}

type CommentItemType = 'request' | 'project' | 'task';

/**
 * Most callers fire these notifications without awaiting them, so that an email never
 * delays or fails a save. A rejection would then be unhandled, and Node ends the process
 * on an unhandled rejection. The decorated methods log and resolve instead.
 */
function NeverRejects(): MethodDecorator {
  return (_target, propertyKey, descriptor: PropertyDescriptor) => {
    const original = descriptor.value;
    descriptor.value = async function (this: { logger: Logger }, ...args: unknown[]) {
      try {
        return await original.apply(this, args);
      } catch (error) {
        this.logger.warn(`${String(propertyKey)} failed: ${error instanceof Error ? error.message : error}`);
      }
    };
    return descriptor;
  };
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  // In-memory dedupe: key -> timestamp
  private recentNotifications = new Map<string, number>();
  private readonly DEDUPE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

  // Clock for the dedupe windows (replaced in specs).
  private now: () => number = () => Date.now();

  // Cache for tenant slugs (tenantId -> slug)
  private tenantSlugCache = new Map<string, string>();
  private readonly MAX_INLINE_IMAGES_PER_EMAIL = 8;
  private readonly MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB per image
  private readonly MAX_INLINE_IMAGES_TOTAL_BYTES = 15 * 1024 * 1024; // 15 MB total

  constructor(
    private readonly dataSource: DataSource,
    private readonly emailService: EmailService,
    private readonly storage: StorageService,
    private readonly preferencesService: NotificationPreferencesService,
  ) {}

  /**
   * Check if we should send a notification (dedupe logic).
   */
  private shouldNotify(userId: string, itemType: string, itemId: string, trigger: string): boolean {
    const key = `${userId}:${itemType}:${itemId}:${trigger}`;
    const lastNotified = this.recentNotifications.get(key);
    const now = this.now();

    if (lastNotified && now - lastNotified < this.DEDUPE_WINDOW_MS) {
      return false;
    }

    this.recentNotifications.set(key, now);
    return true;
  }

  /**
   * Periodic cleanup of dedupe cache (every 10 minutes).
   */
  @Interval(10 * 60 * 1000)
  private cleanupDedupeCache() {
    const now = this.now();
    let cleaned = 0;
    for (const [key, timestamp] of this.recentNotifications) {
      if (now - timestamp > this.DEDUPE_WINDOW_MS) {
        this.recentNotifications.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.logger.debug(`Cleaned ${cleaned} expired entries from notification dedupe cache`);
    }
  }

  /**
   * Get tenant slug from tenantId (cached).
   */
  private async getTenantSlug(tenantId: string): Promise<string | null> {
    // Check cache first
    const cached = this.tenantSlugCache.get(tenantId);
    if (cached) return cached;

    try {
      const result = await this.dataSource.query(
        `SELECT slug FROM tenants WHERE id = $1`,
        [tenantId],
      );
      if (result.length > 0) {
        const slug = result[0].slug;
        this.tenantSlugCache.set(tenantId, slug);
        return slug;
      }
    } catch (error) {
      this.logger.warn(`Failed to get tenant slug for ${tenantId}: ${error}`);
    }
    return null;
  }

  /**
   * Build base URL for a tenant.
   */
  private buildTenantBaseUrl(tenantSlug: string | null): string {
    return resolveNotificationBaseUrl(tenantSlug);
  }

  /**
   * Resolve email branding for a tenant (loads logo from S3 if needed).
   */
  private async resolveBranding(tenantId: string): Promise<EmailBranding> {
    try {
      const rows = await this.dataSource.query(
        `SELECT branding FROM tenants WHERE id = $1`,
        [tenantId],
      );
      const raw = rows[0]?.branding;
      return await resolveEmailBranding(raw, this.storage);
    } catch (error) {
      this.logger.warn(`Failed to resolve email branding for tenant ${tenantId}: ${error}`);
      const { getDefaultEmailBranding } = await import('../email/email-branding');
      return getDefaultEmailBranding();
    }
  }

  /**
   * Build item URL based on type and tenant.
   */
  private async buildItemUrl(itemType: ItemType, itemId: string, tenantId: string, manager?: import('typeorm').EntityManager): Promise<string> {
    const slug = await this.getTenantSlug(tenantId);
    const base = this.buildTenantBaseUrl(slug);

    // For supported types, try to resolve item ref for friendlier URLs
    let ref: string | null = null;
    if (manager) {
      ref = await this.resolveItemRef(itemType, itemId, manager);
    }
    const id = ref ?? itemId;

    switch (itemType) {
      case 'request':
        return `${base}/portfolio/requests/${id}`;
      case 'project':
        return `${base}/portfolio/projects/${id}`;
      case 'task':
        return `${base}/portfolio/tasks/${id}`;
      case 'contract':
        return `${base}/ops/contracts/${id}`;
      case 'opex':
        return `${base}/ops/opex/${id}`;
      case 'capex':
        return `${base}/ops/capex/${id}`;
      case 'asset':
        return `${base}/it/assets/${id}/overview`;
      case 'application':
        return `${base}/it/applications/${id}/overview`;
      case 'location':
        return `${base}/it/locations/${id}/overview`;
      case 'connection':
        return `${base}/it/connections/${id}/overview`;
      case 'interface':
        return `${base}/it/interfaces/${id}/overview`;
      case 'document':
        return `${base}/knowledge/${id}`;
      default:
        return base;
    }
  }

  private async resolveItemRef(itemType: ItemType, itemId: string, manager: import('typeorm').EntityManager): Promise<string | null> {
    const tableMap: Record<string, { table: string; expression: string }> = {
      task: { table: 'tasks', expression: `'T-' || item_number::text` },
      request: { table: 'portfolio_requests', expression: `'REQ-' || item_number::text` },
      project: { table: 'portfolio_projects', expression: `'PRJ-' || item_number::text` },
      opex: { table: 'spend_items', expression: `'OPX-' || item_number::text` },
      capex: { table: 'capex_items', expression: `'CPX-' || item_number::text` },
      asset: { table: 'assets', expression: 'asset_reference' },
      application: { table: 'applications', expression: 'sequential_id' },
      location: { table: 'locations', expression: 'location_reference' },
      connection: { table: 'connections', expression: 'connection_reference' },
      interface: { table: 'interfaces', expression: 'interface_reference' },
      document: { table: 'documents', expression: `'DOC-' || item_number::text` },
    };
    const config = tableMap[itemType];
    if (!config) return null;
    try {
      const rows = await manager.query(
        `SELECT ${config.expression} AS item_ref FROM ${config.table} WHERE id = $1 LIMIT 1`,
        [itemId],
      );
      if (rows.length > 0 && rows[0].item_ref) {
        return String(rows[0].item_ref);
      }
    } catch {
      // Fallback to UUID if lookup fails
    }
    return null;
  }

  /**
   * Check if user wants this notification based on their preferences.
   */
  private checkPreferences(
    prefs: NotificationPreferencesData,
    workspace: 'portfolio' | 'tasks' | 'budget',
    trigger: TriggerType,
    role?: 'assignee' | 'requestor' | 'viewer' | 'owner',
  ): boolean {
    if (!prefs.emails_enabled) return false;

    const ws = prefs.workspace_settings[workspace];
    if (!ws.enabled) return false;

    switch (trigger) {
      case 'status_change':
        return ws.status_changes;
      case 'team_added':
        return (ws as WorkspaceSettings['portfolio']).team_additions ?? false;
      case 'team_change_as_lead':
        return (ws as WorkspaceSettings['portfolio']).team_changes_as_lead ?? false;
      case 'comment':
        return ws.comments;
      case 'assignment':
        // Only for tasks workspace
        if (workspace === 'tasks') {
          const taskSettings = ws as WorkspaceSettings['tasks'];
          if (role === 'assignee') return taskSettings.as_assignee;
          if (role === 'requestor') return taskSettings.as_requestor;
          if (role === 'viewer') return taskSettings.as_viewer;
        }
        return true;
      case 'expiration_warning':
        return (ws as WorkspaceSettings['budget']).expiration_warnings ?? false;
      default:
        return true;
    }
  }

  /**
   * Convert inline image URLs in comment HTML to CID references and attach the files.
   * Falls back gracefully to original URLs when an image cannot be resolved.
   */
  private async embedInlineImagesForComment(params: {
    itemType: CommentItemType;
    itemId: string;
    tenantId: string;
    commentHtml: string;
  }): Promise<{ html: string; attachments: EmailAttachment[] }> {
    const html = params.commentHtml || '';
    if (!html) {
      return { html, attachments: [] };
    }

    const imgSrcRegex = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
    const attachmentIds: string[] = [];
    const seen = new Set<string>();

    let match: RegExpExecArray | null;
    while ((match = imgSrcRegex.exec(html)) !== null) {
      const src = match[1];
      const attachmentId = this.extractInlineAttachmentIdFromSrc(params.itemType, src);
      if (!attachmentId || seen.has(attachmentId)) continue;
      seen.add(attachmentId);
      attachmentIds.push(attachmentId);
    }

    if (attachmentIds.length === 0) {
      return { html, attachments: [] };
    }

    const cidByAttachmentId = new Map<string, string>();
    const attachments: EmailAttachment[] = [];
    let totalBytes = 0;

    for (const attachmentId of attachmentIds) {
      if (attachments.length >= this.MAX_INLINE_IMAGES_PER_EMAIL) break;
      if (totalBytes >= this.MAX_INLINE_IMAGES_TOTAL_BYTES) break;

      const meta = await this.getAttachmentMetaForCommentImage(
        params.itemType,
        params.itemId,
        params.tenantId,
        attachmentId,
      );
      if (!meta) continue;

      const mimeType = String(meta.mimeType || '').toLowerCase();
      if (!mimeType.startsWith('image/')) continue;

      const remainingBudget = this.MAX_INLINE_IMAGES_TOTAL_BYTES - totalBytes;
      const maxBytes = Math.min(this.MAX_INLINE_IMAGE_BYTES, remainingBudget);
      const loaded = await this.readObjectAsBase64(meta.storagePath, maxBytes);
      if (!loaded) continue;

      totalBytes += loaded.size;
      const contentId = `kanap-inline-${attachmentId}`;
      cidByAttachmentId.set(attachmentId, contentId);

      attachments.push({
        filename: this.safeInlineFilename(meta.originalFilename, mimeType, attachmentId),
        content: loaded.base64,
        encoding: 'base64',
        contentType: mimeType,
        contentId,
      });
    }

    if (attachments.length === 0) {
      return { html, attachments: [] };
    }

    const rewrittenHtml = this.replaceInlineImageSourcesWithCid(
      params.itemType,
      html,
      cidByAttachmentId,
    );

    return {
      html: rewrittenHtml,
      attachments,
    };
  }

  private replaceInlineImageSourcesWithCid(
    itemType: CommentItemType,
    html: string,
    cidByAttachmentId: Map<string, string>,
  ): string {
    return html.replace(
      /(<img\b[^>]*\bsrc\s*=\s*)(["'])([^"']+)(\2)/gi,
      (fullMatch, prefix: string, quote: string, src: string) => {
        const attachmentId = this.extractInlineAttachmentIdFromSrc(itemType, src);
        if (!attachmentId) return fullMatch;
        const contentId = cidByAttachmentId.get(attachmentId);
        if (!contentId) return fullMatch;
        return `${prefix}${quote}cid:${contentId}${quote}`;
      },
    );
  }

  private extractInlineAttachmentIdFromSrc(
    itemType: CommentItemType,
    src: string,
  ): string | null {
    const raw = String(src || '').trim();
    if (!raw) return null;

    let pathname: string;
    try {
      if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) {
        const parsed = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
        pathname = parsed.pathname;
      } else if (raw.startsWith('/')) {
        pathname = raw.split(/[?#]/, 1)[0];
      } else {
        return null;
      }
    } catch {
      return null;
    }

    switch (itemType) {
      case 'project': {
        const match = pathname.match(
          /^\/(?:api\/)?portfolio\/projects\/inline\/[^/]+\/([a-f0-9-]+)\/?$/i,
        );
        return match ? match[1] : null;
      }
      case 'request': {
        const match = pathname.match(
          /^\/(?:api\/)?portfolio\/requests\/inline\/[^/]+\/([a-f0-9-]+)\/?$/i,
        );
        return match ? match[1] : null;
      }
      case 'task': {
        const match = pathname.match(
          /^\/(?:api\/)?tasks\/attachments\/[^/]+\/([a-f0-9-]+)\/inline\/?$/i,
        );
        return match ? match[1] : null;
      }
      default:
        return null;
    }
  }

  private async getAttachmentMetaForCommentImage(
    itemType: CommentItemType,
    itemId: string,
    tenantId: string,
    attachmentId: string,
  ): Promise<AttachmentMeta | null> {
    const runner = this.dataSource.createQueryRunner();
    try {
      await runner.connect();
      await runner.startTransaction();
      await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

      let query = '';
      if (itemType === 'project') {
        query = `
          SELECT storage_path, mime_type, original_filename
          FROM portfolio_project_attachments
          WHERE id = $1 AND project_id = $2 AND tenant_id = $3
          LIMIT 1
        `;
      } else if (itemType === 'request') {
        query = `
          SELECT storage_path, mime_type, original_filename
          FROM portfolio_request_attachments
          WHERE id = $1 AND request_id = $2 AND tenant_id = $3
          LIMIT 1
        `;
      } else {
        query = `
          SELECT storage_path, mime_type, original_filename
          FROM task_attachments
          WHERE id = $1 AND task_id = $2 AND tenant_id = $3
          LIMIT 1
        `;
      }

      const rows = await runner.query(query, [attachmentId, itemId, tenantId]);
      await runner.commitTransaction();

      if (!rows.length) {
        this.logger.debug(`No attachment metadata found for inline image ${attachmentId} (${itemType}/${itemId})`);
        return null;
      }

      return {
        storagePath: rows[0].storage_path,
        mimeType: rows[0].mime_type ?? null,
        originalFilename: rows[0].original_filename ?? null,
      };
    } catch (error) {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }
      this.logger.warn(`Failed to resolve attachment metadata for inline image ${attachmentId}: ${error}`);
      return null;
    } finally {
      await runner.release();
    }
  }

  private async readObjectAsBase64(
    storagePath: string,
    maxBytes: number,
  ): Promise<{ base64: string; size: number } | null> {
    try {
      const obj = await this.storage.getObjectStream(storagePath);
      const chunks: Buffer[] = [];
      let total = 0;

      for await (const chunk of obj.stream as any) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.length;
        if (total > maxBytes) {
          this.logger.warn(`Skipping inline image ${storagePath}: exceeds size limit`);
          return null;
        }
        chunks.push(buffer);
      }

      if (total === 0) return null;

      return {
        base64: Buffer.concat(chunks).toString('base64'),
        size: total,
      };
    } catch (error) {
      this.logger.warn(`Failed to load inline image ${storagePath}: ${error}`);
      return null;
    }
  }

  private safeInlineFilename(
    originalFilename: string | null,
    mimeType: string,
    attachmentId: string,
  ): string {
    const clean = (originalFilename || '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/^_+/, '')
      .slice(0, 80);
    if (clean) return clean;

    const ext = this.extensionFromMimeType(mimeType);
    return `inline-${attachmentId}${ext}`;
  }

  private extensionFromMimeType(mimeType: string): string {
    switch (mimeType) {
      case 'image/jpeg':
        return '.jpg';
      case 'image/png':
        return '.png';
      case 'image/gif':
        return '.gif';
      case 'image/webp':
        return '.webp';
      case 'image/svg+xml':
        return '.svg';
      default:
        return '';
    }
  }

  /**
   * Send notification email (fire-and-forget with error logging).
   */
  private async sendNotification(to: string, content: EmailContent): Promise<void> {
    try {
      await this.emailService.send({
        to,
        subject: content.subject,
        html: content.html,
        text: content.text,
        attachments: content.attachments,
      });
    } catch (error) {
      this.logger.error(`Failed to send notification to ${to}: ${error}`);
    }
  }

  private withTaskStatusAction(taskUrl: string, status: string): string {
    try {
      const next = new URL(taskUrl);
      next.searchParams.set('action', 'set_status');
      next.searchParams.set('status', status);
      return next.toString();
    } catch {
      const sep = taskUrl.includes('?') ? '&' : '?';
      return `${taskUrl}${sep}action=set_status&status=${encodeURIComponent(status)}`;
    }
  }

  private buildTaskStatusActionButtons(
    taskUrl: string,
    newStatus: string,
    locale?: string | null,
  ): ActionButton[] {
    const taskActions = getEmailStrings(locale).taskActions;
    switch (newStatus) {
      case 'pending':
        return [
          { label: taskActions.respondAndSetInProgress, url: this.withTaskStatusAction(taskUrl, 'in_progress') },
          { label: taskActions.markDone, url: this.withTaskStatusAction(taskUrl, 'done') },
        ];
      case 'in_testing':
        return [
          { label: taskActions.approve, url: this.withTaskStatusAction(taskUrl, 'done') },
          { label: taskActions.setInProgress, url: this.withTaskStatusAction(taskUrl, 'in_progress') },
        ];
      case 'done':
        return [{ label: taskActions.reopen, url: this.withTaskStatusAction(taskUrl, 'open') }];
      default:
        return [{ label: taskActions.viewTask, url: taskUrl }];
    }
  }

  private groupRecipientsByLocale<T extends { locale?: string | null }>(
    recipients: T[],
  ): Map<string, T[]> {
    const groups = new Map<string, T[]>();
    for (const recipient of recipients) {
      const locale = resolveEmailLocale(recipient.locale);
      const existing = groups.get(locale);
      if (existing) {
        existing.push(recipient);
        continue;
      }
      groups.set(locale, [recipient]);
    }
    return groups;
  }

  // ============================================
  // PUBLIC NOTIFICATION METHODS
  // ============================================

  /**
   * Notify about status change on an item.
   */
  @NeverRejects()
  async notifyStatusChange(params: {
    itemType: Exclude<ItemType, 'asset' | 'application' | 'location' | 'connection' | 'interface' | 'document'>;
    itemId: string;
    itemName: string;
    oldStatus: string;
    newStatus: string;
    recipients: NotificationRecipient[];
    tenantId: string;
    excludeUserId?: string;
    actionButtons?: ActionButton[];
    manager?: EntityManager;
  }): Promise<void> {
    const workspace = this.getWorkspaceForItemType(params.itemType);
    const itemUrl = await this.buildItemUrl(params.itemType, params.itemId, params.tenantId, params.manager);
    const branding = await this.resolveBranding(params.tenantId);
    const localeGroups = new Map<string, NotificationRecipient[]>();

    for (const recipient of params.recipients) {
      if (recipient.userId === params.excludeUserId) continue;
      if (!this.shouldNotify(recipient.userId, params.itemType, params.itemId, 'status_change')) continue;

      // Don't pass manager - notifications are fire-and-forget, so the transaction
      // may be closed by the time this runs. Preferences service uses its own connection.
      const prefs = await this.preferencesService.getForUser(
        recipient.userId,
        params.tenantId,
      );

      if (!this.checkPreferences(prefs, workspace, 'status_change')) continue;

      const locale = resolveEmailLocale(recipient.locale);
      const existing = localeGroups.get(locale);
      if (existing) {
        existing.push(recipient);
      } else {
        localeGroups.set(locale, [recipient]);
      }
    }

    for (const [locale, recipients] of localeGroups) {
      const actionButtons = params.actionButtons
        ?? (params.itemType === 'task'
          ? this.buildTaskStatusActionButtons(itemUrl, params.newStatus, locale)
          : undefined);
      const content = buildStatusChangeEmail({
        itemType: params.itemType,
        itemName: params.itemName,
        itemUrl,
        oldStatus: params.oldStatus,
        newStatus: params.newStatus,
        actionButtons,
        branding,
        locale,
      });

      for (const recipient of recipients) {
        this.sendNotification(recipient.email, content);
      }
    }
  }

  /**
   * Notify task recipients about a unified action (comment + status change in one flow).
   * Delivers merged or split emails per recipient preferences.
   */
  @NeverRejects()
  async notifyUnifiedAction(params: {
    taskId: string;
    taskTitle: string;
    oldStatus?: string;
    newStatus?: string;
    authorId: string;
    authorName: string;
    commentContent?: string;
    recipients: Array<NotificationRecipient & { role: 'assignee' | 'requestor' | 'owner' | 'viewer' }>;
    tenantId: string;
    manager?: EntityManager;
  }): Promise<void> {
    const taskUrl = await this.buildItemUrl('task', params.taskId, params.tenantId, params.manager);
    const branding = await this.resolveBranding(params.tenantId);
    const statusChanged = Boolean(
      params.oldStatus
      && params.newStatus
      && params.oldStatus !== params.newStatus,
    );
    const trimmedComment = params.commentContent?.trim() ?? '';
    const hasComment = trimmedComment.length > 0;

    if (!statusChanged && !hasComment) return;

    let renderedComment: { html: string; textPreview: string } | null = null;
    let embeddedComment: { html: string; attachments: EmailAttachment[] } | null = null;
    if (hasComment) {
      const tenantSlug = await this.getTenantSlug(params.tenantId);
      const tenantBaseUrl = this.buildTenantBaseUrl(tenantSlug);
      const commentAsHtml = renderMarkdownToHtml(trimmedComment);
      renderedComment = renderCommentForEmail({
        commentHtml: commentAsHtml,
        tenantBaseUrl,
        tenantSlug,
      });
      embeddedComment = await this.embedInlineImagesForComment({
        itemType: 'task',
        itemId: params.taskId,
        tenantId: params.tenantId,
        commentHtml: renderedComment.html,
      });
    }

    const localeBuckets = new Map<
    string,
    {
      merged: Array<NotificationRecipient & { role: 'assignee' | 'requestor' | 'owner' | 'viewer' }>;
      status: Array<NotificationRecipient & { role: 'assignee' | 'requestor' | 'owner' | 'viewer' }>;
      comment: Array<NotificationRecipient & { role: 'assignee' | 'requestor' | 'owner' | 'viewer' }>;
    }
    >();

    const getLocaleBucket = (locale: string) => {
      const existing = localeBuckets.get(locale);
      if (existing) return existing;
      const created = { merged: [], status: [], comment: [] };
      localeBuckets.set(locale, created);
      return created;
    };

    for (const recipient of params.recipients) {
      if (recipient.userId === params.authorId) continue;

      const prefs = await this.preferencesService.getForUser(
        recipient.userId,
        params.tenantId,
      );
      const wantsStatus = statusChanged && this.checkPreferences(prefs, 'tasks', 'status_change');
      const wantsComment = hasComment && this.checkPreferences(prefs, 'tasks', 'comment');

      const canSendStatus = wantsStatus
        && this.shouldNotify(recipient.userId, 'task', params.taskId, 'status_change');
      const canSendComment = wantsComment
        && this.shouldNotify(recipient.userId, 'task', params.taskId, 'comment');

      if (statusChanged && hasComment) {
        const bucket = getLocaleBucket(resolveEmailLocale(recipient.locale));
        if (canSendStatus && canSendComment) {
          bucket.merged.push(recipient);
          continue;
        }
        if (canSendStatus) {
          bucket.status.push(recipient);
          continue;
        }
        if (canSendComment) {
          bucket.comment.push(recipient);
        }
        continue;
      }

      if (statusChanged && canSendStatus) {
        getLocaleBucket(resolveEmailLocale(recipient.locale)).status.push(recipient);
        continue;
      }

      if (hasComment && canSendComment) {
        getLocaleBucket(resolveEmailLocale(recipient.locale)).comment.push(recipient);
      }
    }

    for (const [locale, bucket] of localeBuckets) {
      const localizedActionButtons = statusChanged && params.newStatus
        ? this.buildTaskStatusActionButtons(taskUrl, params.newStatus, locale)
        : undefined;

      let statusContent: EmailContent | null = null;
      let commentContent: EmailContent | null = null;
      let mergedContent: EmailContent | null = null;

      if ((bucket.status.length > 0 || bucket.merged.length > 0) && statusChanged && params.oldStatus && params.newStatus) {
        statusContent = buildStatusChangeEmail({
          itemType: 'task',
          itemName: params.taskTitle,
          itemUrl: taskUrl,
          oldStatus: params.oldStatus,
          newStatus: params.newStatus,
          actionButtons: localizedActionButtons,
          branding,
          locale,
        });
      }

      if ((bucket.comment.length > 0 || bucket.merged.length > 0) && hasComment && renderedComment && embeddedComment) {
        commentContent = buildCommentEmail({
          itemType: 'task',
          itemName: params.taskTitle,
          itemUrl: taskUrl,
          authorName: params.authorName,
          commentHtml: embeddedComment.html,
          commentTextPreview: renderedComment.textPreview,
          branding,
          locale,
        });
        commentContent.attachments = [...(commentContent.attachments ?? []), ...embeddedComment.attachments];

        if (statusChanged && params.oldStatus && params.newStatus) {
          mergedContent = buildStatusChangeWithCommentEmail({
            itemType: 'task',
            itemName: params.taskTitle,
            itemUrl: taskUrl,
            oldStatus: params.oldStatus,
            newStatus: params.newStatus,
            authorName: params.authorName,
            commentHtml: embeddedComment.html,
            commentTextPreview: renderedComment.textPreview,
            actionButtons: localizedActionButtons,
            branding,
            locale,
          });
          mergedContent.attachments = [...(mergedContent.attachments ?? []), ...embeddedComment.attachments];
        }
      }

      if (mergedContent) {
        for (const recipient of bucket.merged) {
          this.sendNotification(recipient.email, mergedContent);
        }
      }

      if (statusContent) {
        for (const recipient of bucket.status) {
          this.sendNotification(recipient.email, statusContent);
        }
      }

      if (commentContent) {
        for (const recipient of bucket.comment) {
          this.sendNotification(recipient.email, commentContent);
        }
      }
    }
  }

  /**
   * Notify user they were added to a team.
   */
  @NeverRejects()
  async notifyTeamAdded(params: {
    itemType: 'request' | 'project';
    itemId: string;
    itemName: string;
    role: string;
    addedUser: NotificationRecipient;
    tenantId: string;
    manager?: EntityManager;
  }): Promise<void> {
    if (!this.shouldNotify(params.addedUser.userId, params.itemType, params.itemId, 'team_added')) {
      return;
    }

    const prefs = await this.preferencesService.getForUser(
      params.addedUser.userId,
      params.tenantId,
    );

    if (!this.checkPreferences(prefs, 'portfolio', 'team_added')) return;

    const itemUrl = await this.buildItemUrl(params.itemType, params.itemId, params.tenantId, params.manager);
    const branding = await this.resolveBranding(params.tenantId);
    const content = buildTeamAddedEmail({
      itemType: params.itemType,
      itemName: params.itemName,
      itemUrl,
      role: params.role,
      branding,
      locale: params.addedUser.locale ?? undefined,
    });

    this.sendNotification(params.addedUser.email, content);
  }

  /**
   * Notify IT Lead when a team member is added to a request/project they lead.
   * Skips notification if:
   * - No IT Lead assigned
   * - IT Lead is the actor (person making the change)
   * - IT Lead is the user being added (they already get notifyTeamAdded)
   */
  @NeverRejects()
  async notifyItLeadOfTeamChange(params: {
    itemType: 'request' | 'project';
    itemId: string;
    itemName: string;
    addedUserName: string;
    role: string;
    itLeadId: string | null;
    actorId: string | null;
    addedUserId: string;
    tenantId: string;
  }): Promise<void> {
    // Skip if no IT Lead assigned
    if (!params.itLeadId) return;

    // Skip if IT Lead is the actor (they already know)
    if (params.itLeadId === params.actorId) return;

    // Skip if IT Lead is the one being added (they get notifyTeamAdded instead)
    if (params.itLeadId === params.addedUserId) return;

    // Check dedupe
    if (!this.shouldNotify(params.itLeadId, params.itemType, params.itemId, 'team_change_as_lead')) {
      return;
    }

    // Check IT Lead's preferences
    const prefs = await this.preferencesService.getForUser(
      params.itLeadId,
      params.tenantId,
    );

    if (!this.checkPreferences(prefs, 'portfolio', 'team_change_as_lead')) return;

    // Get IT Lead's email (and verify they're eligible to receive notifications).
    // The read runs inside a tenant-scoped transaction: the request's tenant context is
    // set transaction-locally on its own QueryRunner, so a bare `dataSource.query` would
    // take another pooled connection and be filtered down to zero rows by RLS.
    // The item URL is built on the same connection, so it carries the business reference
    // (PRJ-3, REQ-7) instead of the raw id. The request's own manager is not used: this
    // method is not awaited, and that manager may be released before it runs.
    const lookup = await withTenant(this.dataSource, params.tenantId, async (manager) => {
      const rows: Array<{ id: string; email: string; locale: string | null }> = await manager.query(
        `SELECT u.id, u.email, u.locale FROM users u
         JOIN roles ro ON ro.id = u.role_id AND ro.tenant_id = u.tenant_id
         WHERE u.id = $1 AND u.tenant_id = $2 AND u.status = 'enabled'
           AND (ro.is_system = false OR LOWER(ro.role_name) = 'administrator')`,
        [params.itLeadId, params.tenantId],
      );
      if (rows.length === 0) return null;
      const url = await this.buildItemUrl(params.itemType, params.itemId, params.tenantId, manager);
      return { rows, url };
    });

    if (!lookup) return;

    const itLeadRows = lookup.rows;
    const itemUrl = lookup.url;
    const branding = await this.resolveBranding(params.tenantId);
    const content = buildTeamMemberAddedEmail({
      itemType: params.itemType,
      itemName: params.itemName,
      itemUrl,
      addedUserName: params.addedUserName,
      role: params.role,
      branding,
      locale: itLeadRows[0].locale ?? undefined,
    });

    this.sendNotification(itLeadRows[0].email, content);
  }

  /**
   * Notify the tenant's user administrators that an SSO user was just
   * auto-provisioned and is waiting for access (no role, no permissions).
   * Email only — silently no-ops when no email transport is configured.
   */
  async notifySsoUserProvisioned(params: {
    userName: string;
    userEmail: string;
    tenantId: string;
  }): Promise<void> {
    if (!Features.EMAIL_ENABLED) return;

    // Recipients: users holding admin on the 'users' resource (legacy role
    // column or multi-role table) plus Administrator role holders.
    // Tenant-scoped transaction for the same reason as notifyItLeadOfTeamChange:
    // `users` is under FORCE RLS, so a context-less connection reads zero rows.
    const admins: Array<{ id: string; email: string; locale: string | null }> =
      await withTenant(this.dataSource, params.tenantId, (manager) =>
        manager.query(
          `SELECT DISTINCT u.id, u.email, u.locale
       FROM users u
       WHERE u.tenant_id = $1
         AND u.status = 'enabled'
         AND LOWER(u.email) <> LOWER($2)
         AND (
           EXISTS (
             SELECT 1 FROM roles r
             WHERE r.id = u.role_id AND r.tenant_id = u.tenant_id
               AND LOWER(r.role_name) = 'administrator'
           )
           OR EXISTS (
             SELECT 1 FROM user_roles ur
             JOIN roles r2 ON r2.id = ur.role_id AND r2.tenant_id = ur.tenant_id
             WHERE ur.user_id = u.id AND ur.tenant_id = u.tenant_id
               AND LOWER(r2.role_name) = 'administrator'
           )
           OR EXISTS (
             SELECT 1 FROM role_permissions rp
             WHERE rp.tenant_id = u.tenant_id
               AND rp.resource = 'users' AND rp.level = 'admin'
               AND (
                 rp.role_id = u.role_id
                 OR rp.role_id IN (
                   SELECT ur2.role_id FROM user_roles ur2
                   WHERE ur2.user_id = u.id AND ur2.tenant_id = u.tenant_id
                 )
               )
           )
         )`,
          [params.tenantId, params.userEmail],
        ),
      );
    if (admins.length === 0) return;

    const slug = await this.getTenantSlug(params.tenantId);
    const usersUrl = `${this.buildTenantBaseUrl(slug)}/admin/users`;
    const branding = await this.resolveBranding(params.tenantId);

    for (const [locale, recipients] of this.groupRecipientsByLocale(admins)) {
      const content = buildSsoUserProvisionedEmail({
        userName: params.userName,
        userEmail: params.userEmail,
        usersUrl,
        branding,
        locale,
      });
      for (const recipient of recipients) {
        this.sendNotification(recipient.email, content);
      }
    }
  }

  /**
   * Notify about a new comment.
   */
  @NeverRejects()
  async notifyComment(params: {
    itemType: 'request' | 'project' | 'task';
    itemId: string;
    itemName: string;
    authorId: string;
    authorName: string;
    commentContent: string;
    recipients: NotificationRecipient[];
    tenantId: string;
    manager?: EntityManager;
  }): Promise<void> {
    const workspace = this.getWorkspaceForItemType(params.itemType);
    const tenantSlug = await this.getTenantSlug(params.tenantId);
    const tenantBaseUrl = this.buildTenantBaseUrl(tenantSlug);
    const itemUrl = await this.buildItemUrl(params.itemType, params.itemId, params.tenantId, params.manager);
    const branding = await this.resolveBranding(params.tenantId);
    const commentAsHtml = renderMarkdownToHtml(params.commentContent);
    const renderedComment = renderCommentForEmail({
      commentHtml: commentAsHtml,
      tenantBaseUrl,
      tenantSlug,
    });
    const embeddedComment = await this.embedInlineImagesForComment({
      itemType: params.itemType,
      itemId: params.itemId,
      tenantId: params.tenantId,
      commentHtml: renderedComment.html,
    });
    const localeGroups = new Map<string, NotificationRecipient[]>();

    for (const recipient of params.recipients) {
      // Don't notify the author
      if (recipient.userId === params.authorId) continue;
      if (!this.shouldNotify(recipient.userId, params.itemType, params.itemId, 'comment')) continue;

      // Don't pass manager - notifications are fire-and-forget, so the transaction
      // may be closed by the time this runs. Preferences service uses its own connection.
      const prefs = await this.preferencesService.getForUser(
        recipient.userId,
        params.tenantId,
      );

      if (!this.checkPreferences(prefs, workspace, 'comment')) continue;

      const locale = resolveEmailLocale(recipient.locale);
      const existing = localeGroups.get(locale);
      if (existing) {
        existing.push(recipient);
      } else {
        localeGroups.set(locale, [recipient]);
      }
    }

    for (const [locale, recipients] of localeGroups) {
      const content = buildCommentEmail({
        itemType: params.itemType,
        itemName: params.itemName,
        itemUrl,
        authorName: params.authorName,
        commentHtml: embeddedComment.html,
        commentTextPreview: renderedComment.textPreview,
        branding,
        locale,
      });
      content.attachments = [...(content.attachments ?? []), ...embeddedComment.attachments];

      for (const recipient of recipients) {
        this.sendNotification(recipient.email, content);
      }
    }
  }

  /**
   * Notify about task assignment.
   */
  @NeverRejects()
  async notifyTaskAssigned(params: {
    taskId: string;
    taskTitle: string;
    assigneeId: string;
    assigneeEmail: string;
    assignerName: string;
    dueDate?: string;
    tenantId: string;
    manager?: EntityManager;
    locale?: string | null;
  }): Promise<void> {
    if (!this.shouldNotify(params.assigneeId, 'task', params.taskId, 'assignment')) {
      return;
    }

    const prefs = await this.preferencesService.getForUser(
      params.assigneeId,
      params.tenantId,
    );

    if (!this.checkPreferences(prefs, 'tasks', 'assignment', 'assignee')) return;

    const taskUrl = await this.buildItemUrl('task', params.taskId, params.tenantId, params.manager);
    const branding = await this.resolveBranding(params.tenantId);
    const content = buildTaskAssignedEmail({
      taskTitle: params.taskTitle,
      taskUrl,
      assignerName: params.assignerName,
      dueDate: params.dueDate,
      branding,
      locale: params.locale ?? undefined,
    });

    this.sendNotification(params.assigneeEmail, content);
  }

  /**
   * Notify about expiration warning (for scheduled job). The caller decides the day (the
   * fixed reminder schedule); this sends to opted-in recipients, once per reminder.
   */
  async notifyExpirationWarning(params: {
    itemType: 'contract' | 'opex' | 'capex';
    itemId: string;
    itemName: string;
    expirationDate: string;
    daysRemaining: number;
    warningType: 'expiration' | 'cancellation_deadline';
    recipients: NotificationRecipient[];
    tenantId: string;
    manager?: EntityManager;
  }): Promise<void> {
    const itemUrl = await this.buildItemUrl(params.itemType, params.itemId, params.tenantId, params.manager);
    const branding = await this.resolveBranding(params.tenantId);
    const localeGroups = new Map<string, NotificationRecipient[]>();

    // Opt-in only. Only a recipient who is emailed is recorded, so a user who opts in after
    // a skipped run still gets the reminder on a re-run.
    const optedIn: NotificationRecipient[] = [];
    for (const recipient of params.recipients) {
      // Don't pass manager - notifications are fire-and-forget, so the transaction
      // may be closed by the time this runs. Preferences service uses its own connection.
      const prefs = await this.preferencesService.getForUser(
        recipient.userId,
        params.tenantId,
      );
      if (this.checkPreferences(prefs, 'budget', 'expiration_warning')) optedIn.push(recipient);
    }
    const claimed = await this.claimExpiryReminders(params, optedIn);

    for (const recipient of claimed) {
      const locale = resolveEmailLocale(recipient.locale);
      const existing = localeGroups.get(locale);
      if (existing) {
        existing.push(recipient);
      } else {
        localeGroups.set(locale, [recipient]);
      }
    }

    for (const [locale, recipients] of localeGroups) {
      const content = buildExpirationWarningEmail({
        itemType: params.itemType,
        itemName: params.itemName,
        itemUrl,
        expirationDate: params.expirationDate,
        daysRemaining: params.daysRemaining,
        warningType: params.warningType,
        branding,
        locale,
      });

      for (const recipient of recipients) {
        this.sendNotification(recipient.email, content);
      }
    }
  }

  /**
   * The recipients not yet sent this reminder, recorded as sent before any email goes out.
   * One reminder per recipient, item, deadline and reminder day: the key names the day
   * (deadline minus days left), so a re-run of the daily task on the same day, after an api
   * restart included, sends nothing twice, and the next reminder day is never blocked.
   * The record is a system row of the tenant's audit log (`expiry_reminders`), written in
   * its own transaction so it holds even if the run fails afterwards; the advisory lock
   * serialises two runs on the same item.
   */
  private async claimExpiryReminders(
    params: { itemType: string; itemId: string; warningType: string; expirationDate: string; daysRemaining: number; tenantId: string },
    recipients: NotificationRecipient[],
  ): Promise<NotificationRecipient[]> {
    if (recipients.length === 0) return [];
    const keyOf = (recipient: NotificationRecipient) => [
      recipient.userId, params.itemType, params.itemId, params.warningType,
      params.expirationDate, params.daysRemaining,
    ].join(':');
    return withTenant(this.dataSource, params.tenantId, async (manager) => {
      await manager.query(
        `SELECT pg_advisory_xact_lock($1::int, hashtext($2))`,
        [EXPIRY_REMINDER_LOCK_NAMESPACE, `${params.tenantId}:${params.itemId}`],
      );
      const keys = recipients.map(keyOf);
      const sent: Array<{ key: string }> = await manager.query(
        `SELECT after_json->>'key' AS key FROM audit_log
          WHERE tenant_id = $1 AND record_id = $2 AND table_name = 'expiry_reminders' AND after_json->>'key' = ANY($3::text[])`,
        [params.tenantId, params.itemId, keys],
      );
      const already = new Set(sent.map((row) => row.key));
      const fresh = recipients.filter((recipient, index) => !already.has(keys[index]) && keys.indexOf(keys[index]) === index);
      if (fresh.length > 0) {
        await manager.query(
          `INSERT INTO audit_log (tenant_id, table_name, record_id, action, after_json, source, source_ref)
           SELECT $1::uuid, 'expiry_reminders', $2::uuid, 'create',
                  jsonb_build_object('key', r.key, 'recipient_user_id', r.user_id, 'item_type', $3::text,
                    'warning_type', $4::text, 'expiration_date', $5::text, 'days_remaining', $6::int),
                  'system', 'check-expirations'
             FROM unnest($7::text[], $8::uuid[]) AS r(key, user_id)`,
          [
            params.tenantId, params.itemId, params.itemType, params.warningType, params.expirationDate, params.daysRemaining,
            fresh.map(keyOf), fresh.map((recipient) => recipient.userId),
          ],
        );
      }
      return fresh;
    });
  }

  /**
   * Notify recipients about a shared item (fire-and-forget, no dedupe).
   */
  @NeverRejects()
  async notifyShare(params: {
    itemType: 'request' | 'project' | 'task' | 'opex' | 'capex' | 'asset' | 'application' | 'location' | 'connection' | 'interface' | 'document';
    itemId: string;
    itemName: string;
    senderName: string;
    message?: string;
    recipients: NotificationRecipient[];
    rawEmails?: string[];
    tenantId: string;
    manager?: EntityManager;
  }): Promise<void> {
    const itemUrl = await this.buildItemUrl(params.itemType, params.itemId, params.tenantId, params.manager);
    const branding = await this.resolveBranding(params.tenantId);
    const localeGroups = this.groupRecipientsByLocale(params.recipients);

    for (const [locale, recipients] of localeGroups) {
      const content = buildShareEmail({
        itemType: params.itemType,
        itemName: params.itemName,
        itemUrl,
        senderName: params.senderName,
        message: params.message,
        branding,
        locale,
      });
      for (const recipient of recipients) {
        this.sendNotification(recipient.email, content);
      }
    }

    if ((params.rawEmails ?? []).length > 0) {
      const content = buildShareEmail({
        itemType: params.itemType,
        itemName: params.itemName,
        itemUrl,
        senderName: params.senderName,
        message: params.message,
        branding,
        locale: 'en',
      });
      for (const email of params.rawEmails ?? []) {
        this.sendNotification(email, content);
      }
    }
  }

  /**
   * Get workspace for item type.
   */
  private getWorkspaceForItemType(itemType: ItemType): 'portfolio' | 'tasks' | 'budget' {
    switch (itemType) {
      case 'request':
      case 'project':
        return 'portfolio';
      case 'task':
        return 'tasks';
      case 'contract':
      case 'opex':
      case 'capex':
        return 'budget';
      case 'asset':
      case 'application':
        return 'portfolio';
      default:
        return 'portfolio';
    }
  }

  // ============================================
  // RECIPIENT QUERY HELPERS
  // ============================================

  /**
   * Get recipients for a portfolio request.
   * Excludes users with system roles (e.g., Contact) who cannot log in.
   */
  async getRequestRecipients(
    requestId: string,
    manager: EntityManager,
  ): Promise<NotificationRecipient[]> {
    const rows = await manager.query(
      `SELECT DISTINCT u.id as "userId", u.email, u.first_name as "firstName", u.last_name as "lastName", u.locale
       FROM portfolio_requests r
       LEFT JOIN users u ON u.id IN (
         r.requestor_id, r.business_sponsor_id, r.business_lead_id,
         r.it_sponsor_id, r.it_lead_id
       )
       LEFT JOIN roles ro ON ro.id = u.role_id
       WHERE r.id = $1 AND u.id IS NOT NULL AND u.status = 'enabled'
         AND (ro.is_system = false OR LOWER(ro.role_name) = 'administrator')
       UNION
       SELECT u.id as "userId", u.email, u.first_name as "firstName", u.last_name as "lastName", u.locale
       FROM portfolio_request_team rt
       JOIN users u ON u.id = rt.user_id
       JOIN roles ro ON ro.id = u.role_id
       WHERE rt.request_id = $1 AND u.status = 'enabled'
         AND (ro.is_system = false OR LOWER(ro.role_name) = 'administrator')`,
      [requestId],
    );
    return rows;
  }

  /**
   * Get recipients for a portfolio project.
   * Excludes users with system roles (e.g., Contact) who cannot log in.
   */
  async getProjectRecipients(
    projectId: string,
    manager: EntityManager,
  ): Promise<NotificationRecipient[]> {
    const rows = await manager.query(
      `SELECT DISTINCT u.id as "userId", u.email, u.first_name as "firstName", u.last_name as "lastName", u.locale
       FROM portfolio_projects p
       LEFT JOIN users u ON u.id IN (
         p.business_sponsor_id, p.business_lead_id,
         p.it_sponsor_id, p.it_lead_id
       )
       LEFT JOIN roles ro ON ro.id = u.role_id
       WHERE p.id = $1 AND u.id IS NOT NULL AND u.status = 'enabled'
         AND (ro.is_system = false OR LOWER(ro.role_name) = 'administrator')
       UNION
       SELECT u.id as "userId", u.email, u.first_name as "firstName", u.last_name as "lastName", u.locale
       FROM portfolio_project_team pt
       JOIN users u ON u.id = pt.user_id
       JOIN roles ro ON ro.id = u.role_id
       WHERE pt.project_id = $1 AND u.status = 'enabled'
         AND (ro.is_system = false OR LOWER(ro.role_name) = 'administrator')`,
      [projectId],
    );
    return rows;
  }

  /**
   * Get recipients for a task based on their roles.
   * Excludes users with system roles (e.g., Contact) who cannot log in.
   */
  async getTaskRecipients(
    taskId: string,
    manager: EntityManager,
  ): Promise<Array<NotificationRecipient & { role: 'assignee' | 'requestor' | 'owner' | 'viewer' }>> {
    const task = await manager.query(
      `SELECT t.assignee_user_id, t.creator_id, t.owner_ids, t.viewer_ids
       FROM tasks t
       WHERE t.id = $1`,
      [taskId],
    );

    if (!task.length) return [];

    const t = task[0];
    const userIds = new Set<string>();
    const roleMap = new Map<string, 'assignee' | 'requestor' | 'owner' | 'viewer'>();

    if (t.assignee_user_id) {
      userIds.add(t.assignee_user_id);
      roleMap.set(t.assignee_user_id, 'assignee');
    }
    if (t.creator_id) {
      userIds.add(t.creator_id);
      if (!roleMap.has(t.creator_id)) roleMap.set(t.creator_id, 'requestor');
    }
    for (const ownerId of t.owner_ids || []) {
      userIds.add(ownerId);
      if (!roleMap.has(ownerId)) roleMap.set(ownerId, 'owner');
    }
    for (const viewerId of t.viewer_ids || []) {
      userIds.add(viewerId);
      if (!roleMap.has(viewerId)) roleMap.set(viewerId, 'viewer');
    }

    if (userIds.size === 0) return [];

    const users = await manager.query(
      `SELECT u.id as "userId", u.email, u.first_name as "firstName", u.last_name as "lastName", u.locale
       FROM users u
       JOIN roles ro ON ro.id = u.role_id
       WHERE u.id = ANY($1) AND u.status = 'enabled'
         AND (ro.is_system = false OR LOWER(ro.role_name) = 'administrator')`,
      [Array.from(userIds)],
    );

    return users.map((u: any) => ({
      ...u,
      role: roleMap.get(u.userId) || 'owner',
    }));
  }
}
