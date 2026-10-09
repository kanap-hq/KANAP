import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './audit.entity';
import { AuditService } from './audit.service';
import { User } from '../users/user.entity';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';
import { SecurityEventsService } from './security-events.service';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog, User]),
    forwardRef(() => PermissionsModule),
    forwardRef(() => UsersModule),
  ],
  providers: [AuditService, AuditLogsService, SecurityEventsService],
  controllers: [AuditLogsController],
  exports: [AuditService, SecurityEventsService],
})
export class AuditModule {}
