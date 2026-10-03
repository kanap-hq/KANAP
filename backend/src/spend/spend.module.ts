import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SpendItem } from './spend-item.entity';
import { SpendVersion } from './spend-version.entity';
import { SpendAmount } from './spend-amount.entity';
import { SpendAllocation } from './spend-allocation.entity';
import { SpreadProfile } from './spread-profile.entity';
import { Company } from '../companies/company.entity';
import { Department } from '../departments/department.entity';
import { DepartmentMetric } from '../departments/department-metric.entity';
import { Supplier } from '../suppliers/supplier.entity';
import { Account } from '../accounts/account.entity';
import { SpendItemsService } from './spend-items.service';
import { ListEngineStartupCheck } from '../common/list-engine/list-engine-startup-check';
import { SpendItemsCsvService } from './spend-items-csv.service';
import { SpendBudgetOperationsService } from './spend-budget-operations.service';
import { SpendVersionsService } from './spend-versions.service';
import { SpendAmountsService } from './spend-amounts.service';
import { SpendAllocationsService } from './spend-allocations.service';
import { SpendTasksService } from './spend-tasks.service';
import { TasksService } from './tasks.service';
import { SpendItemsController } from './spend-items.controller';
import { SpendVersionsController } from './spend-versions.controller';
import { SpendTasksController } from './spend-tasks.controller';
import { TasksController } from './tasks.controller';
import { AuditModule } from '../audit/audit.module';
import { AllocationRule } from './allocation-rule.entity';
import { AllocationRulesService } from './allocation-rules.service';
import { AllocationRulesController } from './allocation-rules.controller';
import { CompanyMetric } from '../companies/company-metric.entity';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';
import { forwardRef } from '@nestjs/common';
import { FreezeModule } from '../freeze/freeze.module';
import { ChargebackReportService } from './chargeback-report.service';
import { ChargebackReportController } from './chargeback-report.controller';
import { AllocationCalculatorService } from './allocation-calculator.service';
import { CurrencyModule } from '../currency/currency.module';
import { SpendItemsDeleteService } from './spend-items-delete.service';
import { TasksModule } from '../tasks/tasks.module';
import { SpendLink } from './spend-link.entity';
import { SpendAttachment } from './spend-attachment.entity';
import { StorageModule } from '../common/storage/storage.module';
import { Application } from '../applications/application.entity';
import { ApplicationSpendItemLink } from '../applications/application-spend-item.entity';
import { SpendItemContactLink } from './spend-item-contact.entity';
import { SpendItemContactsService } from './spend-item-contacts.service';
import { ExternalContact } from '../contacts/external-contact.entity';
import { SupplierContactLink } from '../contacts/supplier-contact.entity';
import { PortfolioProjectOpex } from '../portfolio/portfolio-project-opex.entity';
import { PortfolioProject } from '../portfolio/portfolio-project.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { CommonModule } from '../common/common.module';
import { CapexVersion } from '../capex/capex-version.entity';
import { BudgetRowsCsvService } from './budget-rows-csv.service';
import { BudgetRowsController } from './budget-rows.controller';
import { BudgetFileModule } from './budget-file/budget-file.module';
import { UserTimeAggregateService } from '../portfolio/services/user-time-aggregate.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SpendItem, SpendVersion, SpendAmount, SpendAllocation, SpreadProfile, Company, Department, DepartmentMetric, Supplier, Account, AllocationRule, CompanyMetric, SpendLink, SpendAttachment, Application, ApplicationSpendItemLink, SpendItemContactLink, ExternalContact, SupplierContactLink, PortfolioProjectOpex, PortfolioProject, CapexVersion]),
    CommonModule,
    AuditModule,
    PermissionsModule,
    forwardRef(() => UsersModule),
    FreezeModule,
    CurrencyModule,
    TasksModule,
    StorageModule,
    NotificationsModule,
    KnowledgeModule,
    BudgetFileModule,
  ],
  controllers: [SpendItemsController, SpendVersionsController, SpendTasksController, AllocationRulesController, TasksController, ChargebackReportController, BudgetRowsController],
  providers: [
    ListEngineStartupCheck,
    SpendItemsService,
    SpendItemsCsvService,
    SpendBudgetOperationsService,
    SpendItemsDeleteService,
    SpendVersionsService,
    SpendAmountsService,
    SpendAllocationsService,
    AllocationCalculatorService,
    SpendTasksService,
    TasksService,
    AllocationRulesService,
    ChargebackReportService,
    SpendItemContactsService,
    BudgetRowsCsvService,
    UserTimeAggregateService,
  ],
  exports: [
    SpendItemsService,
    SpendVersionsService,
    SpendAmountsService,
    SpendAllocationsService,
    TasksService,
  ],
})
export class SpendModule {}
