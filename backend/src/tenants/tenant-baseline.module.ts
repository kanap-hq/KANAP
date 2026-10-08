import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { CompaniesModule } from '../companies/companies.module';
import { TenantBaselineService } from './tenant-baseline.service';
import { TenantsModule } from './tenants.module';

// Separate from TenantsModule, which AuthModule, AiModule and AdminBrandingModule import: they
// have no use for the companies and charts of accounts the baseline needs.
@Module({
  imports: [TenantsModule, AccountsModule, CompaniesModule],
  providers: [TenantBaselineService],
  exports: [TenantBaselineService],
})
export class TenantBaselineModule {}
