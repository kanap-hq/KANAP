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
import { CapexItemsService, SpendItemsService } from './spend-items.service';
import { ListEngineStartupCheck } from '../common/list-engine/list-engine-startup-check';
import { SpendBudgetOperationsService } from './spend-budget-operations.service';
import { CapexVersionsService, SpendVersionsService } from './spend-versions.service';
import { CapexAmountsService, SpendAmountsService } from './spend-amounts.service';
import { CapexAllocationsService, SpendAllocationsService } from './spend-allocations.service';
import { SpendTasksService } from './spend-tasks.service';
import { TasksService } from './tasks.service';
import { BudgetLinesController } from './budget-lines.controller';
import { BudgetLinesService } from './budget-lines.service';
import { SpendItemsController } from './spend-items.controller';
import { SpendVersionsController } from './spend-versions.controller';
import { SpendTasksController } from './spend-tasks.controller';
import { TasksController } from './tasks.controller';
import { CapexItemsController } from './capex-items.controller';
import { CapexVersionsController } from './capex-versions.controller';
import { CapexTasksController } from './capex-tasks.controller';
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
import { BudgetReportExportController } from './reports/budget-report-export.controller';
import { BudgetOperationsExportController } from './budget-operations-export/budget-operations-export.controller';
import { BudgetOperationsExportService } from './budget-operations-export/budget-operations-export.service';
import { BudgetReportExportService } from './reports/budget-report-export.service';
import { AllocationCalculatorService } from './allocation-calculator.service';
import { CurrencyModule } from '../currency/currency.module';
import { CapexItemsDeleteService, SpendItemsDeleteService } from './spend-items-delete.service';
import { TasksModule } from '../tasks/tasks.module';
import { SpendLink } from './spend-link.entity';
import { SpendAttachment } from './spend-attachment.entity';
import { StorageModule } from '../common/storage/storage.module';
import { Application } from '../applications/application.entity';
import { ApplicationSpendItemLink } from '../applications/application-spend-item.entity';
import { SpendItemContactLink } from './spend-item-contact.entity';
import { CapexItemContactsService, SpendItemContactsService } from './spend-item-contacts.service';
import { ExternalContact } from '../contacts/external-contact.entity';
import { SupplierContactLink } from '../contacts/supplier-contact.entity';
import { PortfolioProjectOpex } from '../portfolio/portfolio-project-opex.entity';
import { PortfolioProject } from '../portfolio/portfolio-project.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { CommonModule } from '../common/common.module';
import { BudgetFileModule } from './budget-file/budget-file.module';
import { UserTimeAggregateService } from '../portfolio/services/user-time-aggregate.service';
import { BudgetLineTypeChangeService } from './budget-line-type-change.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SpendItem, SpendVersion, SpendAmount, SpendAllocation, SpreadProfile, Company, Department, DepartmentMetric, Supplier, Account, AllocationRule, CompanyMetric, SpendLink, SpendAttachment, Application, ApplicationSpendItemLink, SpendItemContactLink, ExternalContact, SupplierContactLink, PortfolioProjectOpex, PortfolioProject]),
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
  // The CAPEX lines live in the same tables (plan planning/budget-unifie.md, lot Z1): their routes
  // are aliases on the same services, for the lines of nature `capex`.
  controllers: [
    BudgetLinesController, SpendItemsController, SpendVersionsController, SpendTasksController, AllocationRulesController, TasksController, ChargebackReportController, BudgetReportExportController, BudgetOperationsExportController,
    CapexItemsController, CapexVersionsController, CapexTasksController,
  ],
  providers: [
    BudgetLinesService,
    ListEngineStartupCheck,
    SpendItemsService,
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
    BudgetReportExportService,
    BudgetOperationsExportService,
    SpendItemContactsService,
    UserTimeAggregateService,
    CapexItemsService,
    CapexItemsDeleteService,
    CapexVersionsService,
    CapexAmountsService,
    CapexAllocationsService,
    CapexItemContactsService,
    BudgetLineTypeChangeService,
  ],
  exports: [
    // The unified read engine: Plaid and the MCP read the budget lines of both natures through it.
    BudgetLinesService,
    // The AI's budget line detail reads each version's allocation as the Allocations tab does.
    AllocationCalculatorService,
    SpendItemsService,
    SpendVersionsService,
    SpendAmountsService,
    SpendAllocationsService,
    // Plaid deletes a line through the screen's own deleter, with its freeze refusal and audit.
    SpendItemsDeleteService,
    CapexItemsDeleteService,
    TasksService,
    CapexItemsService,
    CapexVersionsService,
    CapexAmountsService,
    CapexAllocationsService,
    // Plaid and the MCP read the chargeback reports through the screens' service.
    ChargebackReportService,
  ],
})
export class SpendModule {}
