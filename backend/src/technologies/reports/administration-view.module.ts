import { Module, forwardRef } from '@nestjs/common';
import { ItOpsSettingsModule } from '../../it-ops-settings/it-ops-settings.module';
import { PermissionsModule } from '../../permissions/permissions.module';
import { UsersModule } from '../../users/users.module';
import { AdministrationViewController } from './administration-view.controller';
import { AdministrationViewService } from './administration-view.service';

/** The administration view: the zones and their assets, the directory services, the domains, the control points. */
@Module({
  imports: [PermissionsModule, forwardRef(() => UsersModule), ItOpsSettingsModule],
  controllers: [AdministrationViewController],
  providers: [AdministrationViewService],
})
export class AdministrationViewModule {}
