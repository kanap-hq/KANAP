import { Module, forwardRef } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { StorageModule } from '../common/storage/storage.module';
import { CurrencyModule } from '../currency/currency.module';
import { IncidentsModule } from '../incidents/incidents.module';
import { ItOpsSettingsModule } from '../it-ops-settings/it-ops-settings.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';
import { TechnologyCatalogService } from './catalog/technology-catalog.service';
import { TechnologiesController } from './technologies.controller';
import { TechnologiesDeleteService } from './technologies-delete.service';
import { TechnologiesRelationsService } from './technologies-relations.service';
import { TechnologiesService } from './technologies.service';
import { TechnologyLinksService } from './technology-links.service';
import { TechnologyReachService } from './technology-reach.service';

/**
 * The technology layer (lot S): technologies, versions, the starting catalog, their links to
 * servers, applications and governance objects, and the deductions over the asset graph.
 * `TechnologyLinksService` and `TechnologyReachService` are exported for the assets, the
 * applications and the business processes, which read and write the links from their side.
 */
@Module({
  imports: [AuditModule, PermissionsModule, forwardRef(() => UsersModule), StorageModule, ItOpsSettingsModule, CurrencyModule, IncidentsModule],
  controllers: [TechnologiesController],
  providers: [
    TechnologiesService,
    TechnologyLinksService,
    TechnologyReachService,
    TechnologiesRelationsService,
    TechnologiesDeleteService,
    TechnologyCatalogService,
  ],
  exports: [TechnologiesService, TechnologyLinksService, TechnologyReachService, TechnologyCatalogService],
})
export class TechnologiesModule {}
