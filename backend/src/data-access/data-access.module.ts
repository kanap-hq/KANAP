import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';
import { DataAccessAdminController } from './data-access-admin.controller';
import { DataAccessAdminService } from './data-access-admin.service';
import { DataAccessController } from './data-access.controller';

@Module({
  imports: [AuthModule, AuditModule, PermissionsModule, UsersModule],
  controllers: [DataAccessController, DataAccessAdminController],
  providers: [DataAccessAdminService],
})
export class DataAccessModule {}
