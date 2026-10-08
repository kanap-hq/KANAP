import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../../tenants/tenant.entity';
import { TrialSignup } from '../../public/trial-signup.entity';
import { AdminTenantsController } from './admin-tenants.controller';
import { AdminTenantsService } from './admin-tenants.service';
import { TenantStatsService } from './tenant-stats.service';
import { TenantResetService } from './tenant-reset.service';
import { BillingModule } from '../../billing/billing.module';
import { AuditModule } from '../../audit/audit.module';
import { PlatformAdminGuard } from '../../auth/platform-admin.guard';
import { StorageModule } from '../../common/storage/storage.module';
import { TenantBaselineModule } from '../../tenants/tenant-baseline.module';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant, TrialSignup]), BillingModule, AuditModule, StorageModule, TenantBaselineModule],
  controllers: [AdminTenantsController],
  providers: [AdminTenantsService, TenantStatsService, PlatformAdminGuard, TenantResetService],
  exports: [TenantResetService],
})
export class AdminTenantsModule {}
