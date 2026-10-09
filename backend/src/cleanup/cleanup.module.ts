import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ScheduledTasksModule } from '../admin/scheduled-tasks/scheduled-tasks.module';
import { StorageModule } from '../common/storage/storage.module';
import { AuthEventRetentionService } from './auth-event-retention.service';
import { AiConversationRetentionService } from './ai-conversation-retention.service';
import { AiMutationPreviewExpirationService } from './ai-mutation-preview-expiration.service';
import { LifecycleStatusSyncService } from './lifecycle-status-sync.service';
import { ListContextPurgeService } from './list-context-purge.service';
import { OrphanedAttachmentCleanupService } from './orphaned-attachment-cleanup.service';
import { SearchIndexReindexService } from './search-index-reindex.service';

@Module({
  imports: [StorageModule, ScheduledTasksModule, AiModule],
  providers: [
    OrphanedAttachmentCleanupService,
    AiConversationRetentionService,
    AiMutationPreviewExpirationService,
    SearchIndexReindexService,
    LifecycleStatusSyncService,
    ListContextPurgeService,
    AuthEventRetentionService,
  ],
})
export class CleanupModule {}
