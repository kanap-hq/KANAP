import { Module } from '@nestjs/common';
import { AdminTenantsModule } from '../admin/tenants/admin-tenants.module';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TenantBaselineModule } from '../tenants/tenant-baseline.module';
import { DemoDataController } from './demo-data.controller';
import { DemoDataService } from './demo-data.service';

// Sample data in a cloud tenant: DemoDataService and its routes (Administration > Sample data).
@Module({
  imports: [AdminTenantsModule, TenantBaselineModule, AuthModule, BillingModule, NotificationsModule],
  controllers: [DemoDataController],
  providers: [DemoDataService],
  exports: [DemoDataService],
})
export class DemoDataModule {}
