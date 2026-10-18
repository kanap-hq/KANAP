import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, DataSource } from 'typeorm';
import { NotificationPreferences } from './notification-preferences.entity';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NotificationPreferencesData,
  WorkspaceSettings,
} from './notifications.constants';
import { AuditService } from '../audit/audit.service';
import { withTenant } from '../common/tenant-runner';

@Injectable()
export class NotificationPreferencesService {
  constructor(
    @InjectRepository(NotificationPreferences)
    private readonly repo: Repository<NotificationPreferences>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  /**
   * Get notification preferences for a user.
   * Returns defaults if no preferences exist yet.
   */
  async getForUser(
    userId: string,
    tenantId: string,
    opts?: { manager?: EntityManager },
  ): Promise<NotificationPreferencesData> {
    if (opts?.manager) {
      const prefs = await this.findForUser(opts.manager, userId, tenantId);
      return this.toData(prefs);
    }

    return withTenant(this.dataSource, tenantId, async (manager) => {
      const prefs = await this.findForUser(manager, userId, tenantId);
      return this.toData(prefs);
    });
  }

  /**
   * Update notification preferences for a user.
   * Creates row if it doesn't exist (upsert).
   */
  async updateForUser(
    userId: string,
    tenantId: string,
    updates: Partial<NotificationPreferencesData>,
    actorUserId?: string | null,
    opts?: { manager?: EntityManager },
  ): Promise<NotificationPreferencesData> {
    if (!opts?.manager) {
      return withTenant(this.dataSource, tenantId, (manager) =>
        this.updateForUser(userId, tenantId, updates, actorUserId, { manager }),
      );
    }

    const mg = opts.manager;

    let prefs = await this.findForUser(mg, userId, tenantId);
    const before = prefs ? { ...prefs } : null;

    if (!prefs) {
      // Create new preferences with defaults
      prefs = mg.create(NotificationPreferences, {
        user_id: userId,
        tenant_id: tenantId,
        emails_enabled: DEFAULT_NOTIFICATION_PREFERENCES.emails_enabled,
        workspace_settings: DEFAULT_NOTIFICATION_PREFERENCES.workspace_settings,
        weekly_review_enabled: DEFAULT_NOTIFICATION_PREFERENCES.weekly_review_enabled,
        weekly_review_day: DEFAULT_NOTIFICATION_PREFERENCES.weekly_review_day,
        weekly_review_hour: DEFAULT_NOTIFICATION_PREFERENCES.weekly_review_hour,
        timezone: DEFAULT_NOTIFICATION_PREFERENCES.timezone,
      });
    }

    // Apply updates
    if (updates.emails_enabled !== undefined) {
      prefs.emails_enabled = updates.emails_enabled;
    }

    if (updates.workspace_settings !== undefined) {
      // Deep merge workspace settings
      prefs.workspace_settings = this.deepMergeWorkspaceSettings(
        prefs.workspace_settings,
        updates.workspace_settings,
      );
    }

    if (updates.weekly_review_enabled !== undefined) {
      prefs.weekly_review_enabled = updates.weekly_review_enabled;
    }

    if (updates.weekly_review_day !== undefined) {
      prefs.weekly_review_day = updates.weekly_review_day;
    }

    if (updates.weekly_review_hour !== undefined) {
      prefs.weekly_review_hour = updates.weekly_review_hour;
    }

    if (updates.timezone !== undefined) {
      prefs.timezone = updates.timezone;
    }

    prefs.updated_at = new Date();

    const saved = await mg.save(NotificationPreferences, prefs);

    await this.audit.log(
      {
        table: 'notification_preferences',
        recordId: saved.id,
        action: before ? 'update' : 'create',
        before,
        after: { ...saved },
        userId: actorUserId ?? userId,
      },
      { manager: mg },
    );

    return this.toData(saved);
  }

  private async findForUser(
    manager: EntityManager,
    userId: string,
    tenantId: string,
  ): Promise<NotificationPreferences | null> {
    return manager.findOne(NotificationPreferences, {
      where: { user_id: userId, tenant_id: tenantId },
    });
  }

  private toData(prefs: NotificationPreferences | null): NotificationPreferencesData {
    if (!prefs) {
      return this.defaultPreferences();
    }

    // Merge with defaults to handle any missing fields (schema evolution)
    return {
      emails_enabled: prefs.emails_enabled,
      workspace_settings: this.mergeWorkspaceSettings(prefs.workspace_settings),
      weekly_review_enabled: prefs.weekly_review_enabled,
      weekly_review_day: prefs.weekly_review_day,
      weekly_review_hour: prefs.weekly_review_hour,
      timezone: prefs.timezone,
    };
  }

  private defaultPreferences(): NotificationPreferencesData {
    return {
      emails_enabled: DEFAULT_NOTIFICATION_PREFERENCES.emails_enabled,
      workspace_settings: this.mergeWorkspaceSettings(DEFAULT_NOTIFICATION_PREFERENCES.workspace_settings),
      weekly_review_enabled: DEFAULT_NOTIFICATION_PREFERENCES.weekly_review_enabled,
      weekly_review_day: DEFAULT_NOTIFICATION_PREFERENCES.weekly_review_day,
      weekly_review_hour: DEFAULT_NOTIFICATION_PREFERENCES.weekly_review_hour,
      timezone: DEFAULT_NOTIFICATION_PREFERENCES.timezone,
    };
  }

  /**
   * Merge user's workspace settings with defaults to handle missing fields.
   */
  private mergeWorkspaceSettings(userSettings: Partial<WorkspaceSettings>): WorkspaceSettings {
    const defaults = DEFAULT_NOTIFICATION_PREFERENCES.workspace_settings;
    return {
      portfolio: {
        ...defaults.portfolio,
        ...(userSettings?.portfolio ?? {}),
      },
      tasks: {
        ...defaults.tasks,
        ...(userSettings?.tasks ?? {}),
      },
      budget: {
        ...defaults.budget,
        ...(userSettings?.budget ?? {}),
      },
      technologies: {
        ...defaults.technologies,
        ...(userSettings?.technologies ?? {}),
      },
    };
  }

  /**
   * Deep merge for partial workspace settings updates.
   */
  private deepMergeWorkspaceSettings(
    existing: WorkspaceSettings,
    updates: Partial<WorkspaceSettings>,
  ): WorkspaceSettings {
    return {
      portfolio: {
        ...existing.portfolio,
        ...(updates.portfolio ?? {}),
      },
      tasks: {
        ...existing.tasks,
        ...(updates.tasks ?? {}),
      },
      budget: {
        ...existing.budget,
        ...(updates.budget ?? {}),
      },
      technologies: {
        ...DEFAULT_NOTIFICATION_PREFERENCES.workspace_settings.technologies,
        ...(existing.technologies ?? {}),
        ...(updates.technologies ?? {}),
      },
    };
  }
}
