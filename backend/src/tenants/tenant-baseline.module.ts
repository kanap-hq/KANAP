import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { CompaniesModule } from '../companies/companies.module';
import { AuditModule } from '../audit/audit.module';
import { ItOpsSettingsModule } from '../it-ops-settings/it-ops-settings.module';
import { TechnologyCatalogService } from '../technologies/catalog/technology-catalog.service';
import { TechnologyCpeEventsModule } from '../technologies/technology-cpe-events.module';
import { TenantBaselineService } from './tenant-baseline.service';
import { TenantsModule } from './tenants.module';

// Separate from TenantsModule, which AuthModule, AiModule and AdminBrandingModule import: they
// have no use for the companies, charts of accounts and technology catalog the baseline needs.
@Module({
  imports: [TenantsModule, AccountsModule, CompaniesModule, AuditModule, ItOpsSettingsModule, TechnologyCpeEventsModule],
  // Its own catalog instance: TechnologiesModule reaches DemoDataModule, which needs this module.
  // The shared TechnologyCpeEvents bus is imported on its own, so this instance still emits.
  providers: [TenantBaselineService, TechnologyCatalogService],
  exports: [TenantBaselineService],
})
export class TenantBaselineModule {}
