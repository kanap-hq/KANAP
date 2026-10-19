import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from './company.entity';
import { CompaniesService } from './companies.service';
import { CompaniesDeleteService } from './companies-delete.service';
import { CompaniesController } from './companies.controller';
import { AuditModule } from '../audit/audit.module';
import { CompanyMetric } from './company-metric.entity';
import { CompanyMetricsService } from './company-metrics.service';
import { CompanyMetricsController } from './company-metrics.controller';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';
import { forwardRef } from '@nestjs/common';
import { FreezeModule } from '../freeze/freeze.module';
import { CurrencyModule } from '../currency/currency.module';
import { CommonModule } from '../common/common.module';
import { ChartOfAccounts } from '../accounts/chart-of-accounts.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Company, CompanyMetric, ChartOfAccounts]), AuditModule, PermissionsModule, forwardRef(() => UsersModule), FreezeModule, CurrencyModule, CommonModule],
  providers: [CompaniesService, CompaniesDeleteService, CompanyMetricsService],
  controllers: [CompaniesController, CompanyMetricsController],
  exports: [CompaniesService, CompanyMetricsService],
})
export class CompaniesModule {}
