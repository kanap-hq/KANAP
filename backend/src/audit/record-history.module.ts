import { Module } from '@nestjs/common';
import { AuditModule } from './audit.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';
import { RecordHistoryController } from './record-history.controller';
import { RecordHistoryService } from './record-history.service';

/**
 * The record history route (`GET /records/:table/:id/history`) and its service.
 *
 * It lives beside `AuditModule` rather than inside it because its document check injects
 * `KnowledgeService`: `KnowledgeModule` imports `AuditModule` (for `AuditService`), so putting the
 * import in `AuditModule` closes a module cycle `AuditModule → KnowledgeModule → NotificationsModule
 * → AuditModule`, which Nest cannot evaluate. This module imports both sides; nothing imports it
 * except `AppModule`, so no cycle remains.
 *
 * The guards of the route resolve here, hence the permission and user modules.
 */
@Module({
  imports: [AuditModule, KnowledgeModule, PermissionsModule, UsersModule],
  controllers: [RecordHistoryController],
  providers: [RecordHistoryService],
  exports: [RecordHistoryService],
})
export class RecordHistoryModule {}
