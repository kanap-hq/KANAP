import { Module } from '@nestjs/common';
import { AdminTenantsModule } from '../admin/tenants/admin-tenants.module';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { TenantBaselineModule } from '../tenants/tenant-baseline.module';
import { DemoDataService } from './demo-data.service';

// Sample data in a cloud tenant (DemoDataService). The routes and the page come later.
@Module({
  imports: [AdminTenantsModule, TenantBaselineModule, AuthModule, BillingModule],
  providers: [DemoDataService],
  exports: [DemoDataService],
})
export class DemoDataModule {}
