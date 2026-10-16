import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BusinessProcess } from './business-process.entity';
import { BusinessProcessCategory } from './business-process-category.entity';
import { BusinessProcessCategoryLink } from './business-process-category-link.entity';
import { BusinessProcessesService } from './business-processes.service';
import { BusinessProcessesController, BusinessProcessCategoriesController } from './business-processes.controller';
import { BusinessProcessesDeleteService } from './business-processes-delete.service';
import { BusinessProcessCategoriesService } from './business-process-categories.service';
import { AuditModule } from '../audit/audit.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';
import { User } from '../users/user.entity';
import { TechnologiesModule } from '../technologies/technologies.module';
import { BusinessProcessApplicationsController } from './business-process-applications.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([BusinessProcess, BusinessProcessCategory, BusinessProcessCategoryLink, User]),
    AuditModule,
    PermissionsModule,
    forwardRef(() => UsersModule),
    TechnologiesModule,
  ],
  controllers: [BusinessProcessesController, BusinessProcessCategoriesController, BusinessProcessApplicationsController],
  providers: [BusinessProcessesService, BusinessProcessesDeleteService, BusinessProcessCategoriesService],
  exports: [BusinessProcessesService, BusinessProcessCategoriesService],
})
export class BusinessProcessesModule {}
