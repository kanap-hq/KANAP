import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BusinessProcess } from './business-process.entity';
import { BusinessProcessesService } from './business-processes.service';
import { BusinessProcessesController } from './business-processes.controller';
import { BusinessProcessesDeleteService } from './business-processes-delete.service';
import { AuditModule } from '../audit/audit.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';
import { User } from '../users/user.entity';
import { TechnologiesModule } from '../technologies/technologies.module';
import { BusinessProcessApplicationsController } from './business-process-applications.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([BusinessProcess, User]),
    AuditModule,
    PermissionsModule,
    forwardRef(() => UsersModule),
    TechnologiesModule,
  ],
  controllers: [BusinessProcessesController, BusinessProcessApplicationsController],
  providers: [BusinessProcessesService, BusinessProcessesDeleteService],
  exports: [BusinessProcessesService],
})
export class BusinessProcessesModule {}
