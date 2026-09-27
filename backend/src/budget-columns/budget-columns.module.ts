import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../tenants/tenant.entity';
import { AuditModule } from '../audit/audit.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';
import { BudgetColumnsService } from './budget-columns.service';
import { BudgetColumnsController } from './budget-columns.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant]), AuditModule, PermissionsModule, forwardRef(() => UsersModule)],
  controllers: [BudgetColumnsController],
  providers: [BudgetColumnsService],
  exports: [BudgetColumnsService],
})
export class BudgetColumnsModule {}
