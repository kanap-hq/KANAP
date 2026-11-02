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
  // The assistant reads the screen's overview and the access tabs through the same service.
  exports: [DataAccessAdminService],
})
export class DataAccessModule {}
