import { Module, forwardRef } from '@nestjs/common';
import { ItOpsSettingsModule } from '../../it-ops-settings/it-ops-settings.module';
import { PermissionsModule } from '../../permissions/permissions.module';
import { UsersModule } from '../../users/users.module';
import { TechnologiesModule } from '../technologies.module';
import { AdministrationViewController } from './administration-view.controller';
import { AdministrationViewService } from './administration-view.service';

/** The administration view (lot A1a): reads the zones and domains catalogs and the technology deductions. */
@Module({
  imports: [PermissionsModule, forwardRef(() => UsersModule), ItOpsSettingsModule, TechnologiesModule],
  controllers: [AdministrationViewController],
  providers: [AdministrationViewService],
})
export class AdministrationViewModule {}
