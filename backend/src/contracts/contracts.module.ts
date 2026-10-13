import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contract } from './contract.entity';
import { ContractSpendItem } from './contract-spend-item.entity';
import { ContractLink } from './contract-link.entity';
import { ContractAttachment } from './contract-attachment.entity';
import { ContractsService } from './contracts.service';
import { ContractsController } from './contracts.controller';
import { SpendItemContractsController } from './spend-item-contracts.controller';
import { CapexItemContractsController } from './capex-item-contracts.controller';
import { AuditModule } from '../audit/audit.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';
import { forwardRef } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module';
import { StorageModule } from '../common/storage/storage.module';
import { ContractContactLink } from './contract-contact.entity';
import { ContractContactsService } from './contract-contacts.service';
import { ExternalContact } from '../contacts/external-contact.entity';
import { SupplierContactLink } from '../contacts/supplier-contact.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { CurrencyModule } from '../currency/currency.module';
import { ScheduledTasksModule } from '../admin/scheduled-tasks/scheduled-tasks.module';
import { Tenant } from '../tenants/tenant.entity';
import { ContractSettingsService } from './contract-settings.service';
import { ContractSettingsController } from './contract-settings.controller';
import { ContractRenewalService } from './contract-renewal.service';
import { ContractRenewalController } from './contract-renewal.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Contract, ContractSpendItem, ContractLink, ContractAttachment, ContractContactLink, ExternalContact, SupplierContactLink, Tenant]), AuditModule, PermissionsModule, forwardRef(() => UsersModule), TasksModule, StorageModule, NotificationsModule, CurrencyModule, ScheduledTasksModule],
  providers: [ContractsService, ContractContactsService, ContractSettingsService, ContractRenewalService],
  controllers: [ContractsController, ContractRenewalController, ContractSettingsController, SpendItemContractsController, CapexItemContractsController],
  exports: [ContractsService],
})
export class ContractsModule {}
