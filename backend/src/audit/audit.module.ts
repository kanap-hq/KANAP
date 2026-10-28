import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './audit.entity';
import { AuditService } from './audit.service';
import { User } from '../users/user.entity';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';
import { RecordHistoryController } from './record-history.controller';
import { RecordHistoryService } from './record-history.service';
import { SecurityEventsService } from './security-events.service';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog, User]),
    forwardRef(() => PermissionsModule),
    forwardRef(() => UsersModule),
    // The record history reads a document's library ACL through `KnowledgeService`.
    forwardRef(() => KnowledgeModule),
  ],
  providers: [AuditService, AuditLogsService, SecurityEventsService, RecordHistoryService],
  controllers: [AuditLogsController, RecordHistoryController],
  exports: [AuditService, SecurityEventsService, RecordHistoryService],
})
export class AuditModule {}
