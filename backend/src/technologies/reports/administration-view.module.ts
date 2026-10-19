import { Module, forwardRef } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module';
import { ItOpsSettingsModule } from '../../it-ops-settings/it-ops-settings.module';
import { PermissionsModule } from '../../permissions/permissions.module';
import { UsersModule } from '../../users/users.module';
import { AdministrationViewController } from './administration-view.controller';
import { AdministrationViewService } from './administration-view.service';

/** The administration view: zone counts, the asset page, directory services and domains, the control points. */
@Module({
  imports: [PermissionsModule, forwardRef(() => UsersModule), ItOpsSettingsModule, AuditModule],
  controllers: [AdministrationViewController],
  providers: [AdministrationViewService],
})
export class AdministrationViewModule {}
