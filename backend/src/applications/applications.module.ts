import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Application } from './application.entity';
import { ApplicationOwner } from './application-owner.entity';
import { ApplicationCompany } from './application-company.entity';
import { ApplicationDepartment } from './application-department.entity';
import { ApplicationContractLink } from './application-contract.entity';
import { ApplicationSpendItemLink } from './application-spend-item.entity';
import { ApplicationLink } from './application-link.entity';
import { ApplicationAttachment } from './application-attachment.entity';
import { ApplicationDataResidency } from './application-data-residency.entity';
import { ApplicationSuiteLink } from './application-suite.entity';
import { ApplicationSupportContact } from './application-support-contact.entity';
import { ApplicationProject } from './application-project.entity';
import { ApplicationsDeleteService } from './applications-delete.service';
import { ApplicationsCsvService } from './applications-csv.service';
import { ApplicationsController } from './applications.controller';
import { AuditModule } from '../audit/audit.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';
import { StorageModule } from '../common/storage/storage.module';
import { ItOpsSettingsModule } from '../it-ops-settings/it-ops-settings.module';
import { CsvModule } from '../common/csv';
import { PortfolioProject } from '../portfolio/portfolio-project.entity';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { InterfacesModule } from '../interfaces/interfaces.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TasksModule } from '../tasks/tasks.module';

// Decomposed services
import {
  ApplicationsService,
  ApplicationsListService,
  ApplicationsCrudService,
  ApplicationsOwnersService,
  ApplicationsInstancesService,
  ApplicationsResidencyService,
  ApplicationsStructureService,
  ApplicationsLifecycleService,
} from './services';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Application,
      ApplicationOwner,
      ApplicationCompany,
      ApplicationDepartment,
      ApplicationContractLink,
      ApplicationSpendItemLink,
      ApplicationLink,
      ApplicationAttachment,
      ApplicationDataResidency,
      ApplicationSuiteLink,
      ApplicationSupportContact,
      ApplicationProject,
      PortfolioProject,
    ]),
    AuditModule,
    PermissionsModule,
    forwardRef(() => UsersModule),
    StorageModule,
    ItOpsSettingsModule,
    CsvModule,
    KnowledgeModule,
    InterfacesModule,
    NotificationsModule,
    TasksModule,
  ],
  providers: [
    // Decomposed services (order matters for DI)
    ApplicationsListService,
    ApplicationsCrudService,
    ApplicationsOwnersService,
    ApplicationsInstancesService,
    ApplicationsResidencyService,
    ApplicationsStructureService,
    ApplicationsLifecycleService,
    // Main facade service
    ApplicationsService,
    // Delete service (unchanged)
    ApplicationsDeleteService,
    // CSV service (V2)
    ApplicationsCsvService,
  ],
  controllers: [ApplicationsController],
  exports: [ApplicationsService, ApplicationsCsvService, TypeOrmModule],
})
export class ApplicationsModule {}
