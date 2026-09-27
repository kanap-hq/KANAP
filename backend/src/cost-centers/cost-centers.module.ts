import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';
import { CostCenter } from './cost-center.entity';
import { CostCentersCsvService } from './cost-centers-csv.service';
import { CostCentersDeleteService } from './cost-centers-delete.service';
import { CostCentersController } from './cost-centers.controller';
import { CostCentersService } from './cost-centers.service';

@Module({
  imports: [TypeOrmModule.forFeature([CostCenter]), AuditModule, PermissionsModule, forwardRef(() => UsersModule)],
  providers: [CostCentersService, CostCentersDeleteService, CostCentersCsvService],
  controllers: [CostCentersController],
  exports: [CostCentersService],
})
export class CostCentersModule {}
