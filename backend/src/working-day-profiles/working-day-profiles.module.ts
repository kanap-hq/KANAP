import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';
import { WorkingDayProfile } from './working-day-profile.entity';
import { WorkingDayProfilesCsvService } from './working-day-profiles-csv.service';
import { WorkingDayProfilesDeleteService } from './working-day-profiles-delete.service';
import { WorkingDayProfilesController } from './working-day-profiles.controller';
import { WorkingDayProfilesService } from './working-day-profiles.service';

@Module({
  imports: [TypeOrmModule.forFeature([WorkingDayProfile]), AuditModule, PermissionsModule, forwardRef(() => UsersModule)],
  providers: [WorkingDayProfilesService, WorkingDayProfilesDeleteService, WorkingDayProfilesCsvService],
  controllers: [WorkingDayProfilesController],
  exports: [WorkingDayProfilesService],
})
export class WorkingDayProfilesModule {}
