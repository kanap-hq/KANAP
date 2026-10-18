import { Module, forwardRef } from '@nestjs/common';
import { ApplicationsModule } from '../applications/applications.module';
import { AuditModule } from '../audit/audit.module';
import { StorageModule } from '../common/storage/storage.module';
import { CurrencyModule } from '../currency/currency.module';
import { IncidentsModule } from '../incidents/incidents.module';
import { ItOpsSettingsModule } from '../it-ops-settings/it-ops-settings.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';
import { ApplicationConversionController } from './application-conversion.controller';
import { ApplicationConversionService } from './application-conversion.service';
import { TechnologyCatalogService } from './catalog/technology-catalog.service';
import { TechnologiesController } from './technologies.controller';
import { TechnologiesDeleteService } from './technologies-delete.service';
import { TechnologiesRelationsService } from './technologies-relations.service';
import { TechnologyCpeEvents } from './technology-cpe-events';
import { TechnologiesService } from './technologies.service';
import { TechnologyLinksService } from './technology-links.service';
import { TechnologyReachService } from './technology-reach.service';
import { EndOfSupportController } from './reports/end-of-support.controller';
import { EndOfSupportService } from './reports/end-of-support.service';

/**
 * The technology layer (lot S): technologies, versions, the starting catalog, their links to
 * servers, applications and governance objects, and the deductions over the asset graph.
 * `TechnologyLinksService` and `TechnologyReachService` are exported for the assets, the
 * applications and the business processes, which read and write the links from their side.
 * `ApplicationConversionController` turns an application into a technology (lot C1).
 */
@Module({
  imports: [AuditModule, PermissionsModule, forwardRef(() => UsersModule), StorageModule, ItOpsSettingsModule, CurrencyModule, IncidentsModule, forwardRef(() => ApplicationsModule)],
  // The report's controller first: its static paths are registered before `technologies/:id`.
  controllers: [EndOfSupportController, TechnologiesController, ApplicationConversionController],
  providers: [
    TechnologiesService,
    TechnologyLinksService,
    TechnologyReachService,
    TechnologiesRelationsService,
    TechnologiesDeleteService,
    TechnologyCatalogService,
    TechnologyCpeEvents,
    EndOfSupportService,
    ApplicationConversionService,
  ],
  exports: [TechnologiesService, TechnologyLinksService, TechnologyReachService, TechnologyCatalogService, TechnologyCpeEvents],
})
export class TechnologiesModule {}
