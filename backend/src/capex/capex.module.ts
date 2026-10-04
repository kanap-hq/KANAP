import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CapexItem } from './capex-item.entity';
import { CapexVersion } from './capex-version.entity';
import { CapexAmount } from './capex-amount.entity';
import { CapexAllocation } from './capex-allocation.entity';
import { AllocationRule } from '../spend/allocation-rule.entity';
import { Company } from '../companies/company.entity';
import { CompanyMetric } from '../companies/company-metric.entity';
import { CapexAllocationsService } from './capex-allocations.service';
import { CapexAllocationCalculatorService } from './capex-allocation-calculator.service';
import { CapexItemsService } from './capex-items.service';
import { CapexVersionsService } from './capex-versions.service';
import { CapexAmountsService } from './capex-amounts.service';
import { CapexItemsController } from './capex-items.controller';
import { CapexTasksController } from './capex-tasks.controller';
import { TasksModule } from '../tasks/tasks.module';
import { CapexVersionsController } from './capex-versions.controller';
import { AuditModule } from '../audit/audit.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';
import { forwardRef } from '@nestjs/common';
import { FreezeModule } from '../freeze/freeze.module';
import { CurrencyModule } from '../currency/currency.module';
import { CapexItemsDeleteService } from './capex-items-delete.service';
import { CapexLink } from './capex-link.entity';
import { CapexAttachment } from './capex-attachment.entity';
import { StorageModule } from '../common/storage/storage.module';
import { CapexItemContactLink } from './capex-item-contact.entity';
import { CapexItemContactsService } from './capex-item-contacts.service';
import { ExternalContact } from '../contacts/external-contact.entity';
import { SupplierContactLink } from '../contacts/supplier-contact.entity';
import { PortfolioProjectCapex } from '../portfolio/portfolio-project-capex.entity';
import { PortfolioProject } from '../portfolio/portfolio-project.entity';
import { CommonModule } from '../common/common.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UserTimeAggregateService } from '../portfolio/services/user-time-aggregate.service';
import { BudgetFileModule } from '../spend/budget-file/budget-file.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CapexItem, CapexVersion, CapexAmount, CapexAllocation, AllocationRule, Company, CompanyMetric, CapexLink, CapexAttachment, CapexItemContactLink, ExternalContact, SupplierContactLink, PortfolioProjectCapex, PortfolioProject]),
    CommonModule,
    AuditModule,
    PermissionsModule,
    forwardRef(() => UsersModule),
    FreezeModule,
    CurrencyModule,
    TasksModule,
    StorageModule,
    NotificationsModule,
    BudgetFileModule,
  ],
  controllers: [CapexItemsController, CapexVersionsController, CapexTasksController],
  providers: [CapexItemsService, CapexItemsDeleteService, CapexVersionsService, CapexAmountsService, CapexAllocationsService, CapexAllocationCalculatorService, CapexItemContactsService, UserTimeAggregateService],
  exports: [CapexItemsService, CapexVersionsService, CapexAmountsService, CapexAllocationsService],
})
export class CapexModule {}
