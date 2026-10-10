import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Asset } from './asset.entity';
import { AssetClusterMember } from './asset-cluster-member.entity';
import { AssetHardwareInfo } from './asset-hardware-info.entity';
import { AssetSupportInfo } from './asset-support-info.entity';
import { AssetRelation } from './asset-relation.entity';
import { AssetSpendItemLink } from './asset-spend-item.entity';
import { AssetContractLink } from './asset-contract.entity';
import { AssetLink } from './asset-link.entity';
import { AssetAttachment } from './asset-attachment.entity';
import { AssetSupportContact } from './asset-support-contact.entity';
import { AssetProject } from './asset-project.entity';
import { AssetsController } from './assets.controller';
import { AssetsDeleteService } from './assets-delete.service';
import { AssetsCsvService } from './assets-csv.service';
import { AuditModule } from '../audit/audit.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';
import { ItOpsSettingsModule } from '../it-ops-settings/it-ops-settings.module';
import { StorageModule } from '../common/storage/storage.module';
import { CsvModule } from '../common/csv';
import { PortfolioProject } from '../portfolio/portfolio-project.entity';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TasksModule } from '../tasks/tasks.module';

// Decomposed services
import {
  AssetsService,
  AssetsListService,
  AssetsCrudService,
  AssetsHardwareService,
  AssetsSupportService,
  AssetsRelationsService,
  AssetsAttachmentsService,
  AssetsValidationService,
} from './services';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Asset,
      AssetClusterMember,
      AssetHardwareInfo,
      AssetSupportInfo,
      AssetRelation,
      AssetSpendItemLink,
      AssetContractLink,
      AssetLink,
      AssetAttachment,
      AssetSupportContact,
      AssetProject,
      PortfolioProject,
    ]),
    AuditModule,
    PermissionsModule,
    forwardRef(() => UsersModule),
    ItOpsSettingsModule,
    StorageModule,
    CsvModule,
    KnowledgeModule,
    NotificationsModule,
    TasksModule,
  ],
  providers: [
    // Validation service (no dependencies on other asset services)
    AssetsValidationService,
    // Decomposed services (order matters for DI)
    AssetsListService,
    AssetsCrudService,
    AssetsHardwareService,
    AssetsSupportService,
    AssetsRelationsService,
    AssetsAttachmentsService,
    // Main facade service
    AssetsService,
    // Delete service (unchanged)
    AssetsDeleteService,
    // CSV service
    AssetsCsvService,
  ],
  controllers: [AssetsController],
  exports: [AssetsService, AssetsCsvService, TypeOrmModule],
})
export class AssetsModule {}
