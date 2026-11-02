import { forwardRef, Module } from '@nestjs/common';
import { ItOpsSettingsModule } from '../it-ops-settings/it-ops-settings.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';
import { ImportExamplesController } from './import-examples.controller';
import { ImportExamplesService } from './import-examples.service';

@Module({
  imports: [ItOpsSettingsModule, PermissionsModule, forwardRef(() => UsersModule)],
  controllers: [ImportExamplesController],
  providers: [ImportExamplesService],
})
export class ImportExamplesModule {}
