import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Incident } from './incident.entity';
import { IncidentEntry } from './incident-entry.entity';
import { IncidentAsset } from './incident-asset.entity';
import { IncidentTechnology } from './incident-technology.entity';
import { IncidentApplication } from './incident-application.entity';
import { IncidentAttachment } from './incident-attachment.entity';
import { IncidentsController } from './incidents.controller';
import { IncidentsTasksController } from './incidents-tasks.controller';
import { IncidentsCsvService } from './incidents-csv.service';
import { AuditModule } from '../audit/audit.module';
import { CommonModule } from '../common/common.module';
import { CsvModule } from '../common/csv';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';
import { StorageModule } from '../common/storage/storage.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { ItOpsSettingsModule } from '../it-ops-settings/it-ops-settings.module';
import { TasksModule } from '../tasks/tasks.module';
import { DemoDataModule } from '../demo-data/demo-data.module';
import {
  IncidentEntriesService,
  IncidentJournalImportService,
  IncidentRecordService,
  IncidentReportService,
  IncidentRelationsService,
  IncidentsAttachmentsService,
  IncidentsDeleteService,
  IncidentsService,
} from './services';
import { UserTimeAggregateService } from '../portfolio/services/user-time-aggregate.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Incident, IncidentEntry, IncidentAsset, IncidentApplication, IncidentTechnology, IncidentAttachment]),
    CommonModule,
    CsvModule,
    AuditModule,
    PermissionsModule,
    forwardRef(() => UsersModule),
    StorageModule,
    KnowledgeModule,
    ItOpsSettingsModule,
    TasksModule,
    DemoDataModule,
  ],
  controllers: [IncidentsController, IncidentsTasksController],
  providers: [
    IncidentsService,
    IncidentEntriesService,
    IncidentRelationsService,
    IncidentsAttachmentsService,
    IncidentRecordService,
    IncidentReportService,
    IncidentsCsvService,
    IncidentsDeleteService,
    IncidentJournalImportService,
    UserTimeAggregateService,
  ],
  exports: [IncidentsService, IncidentRecordService, IncidentRelationsService],
})
export class IncidentsModule {}
