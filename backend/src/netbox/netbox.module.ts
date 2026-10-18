import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduledTasksModule } from '../admin/scheduled-tasks/scheduled-tasks.module';
import { AiProviderSupportModule } from '../ai/ai-provider-support.module';
import { AiAdapterConfig } from '../ai/control-plane/providers/adapter-config.entity';
import { AssetsModule } from '../assets/assets.module';
import { ItOpsSettingsModule } from '../it-ops-settings/it-ops-settings.module';
import { LocationsModule } from '../locations/locations.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { TechnologiesModule } from '../technologies/technologies.module';
import { UsersModule } from '../users/users.module';
import { AssetExternalLink } from './asset-external-link.entity';
import { NetboxClient } from './netbox.client';
import { NetboxConfigService } from './netbox-config.service';
import { NetboxController } from './netbox.controller';
import { NetboxScheduledSyncService } from './netbox-scheduled-sync.service';
import { NetboxSyncService } from './netbox-sync.service';

// Netbox inventory integration. AiProviderSupportModule is imported for the
// secret cipher only: the connection lives in ai_adapter_configs, but nothing
// here depends on AiModule (which would be a circular import).
@Module({
  imports: [
    TypeOrmModule.forFeature([AssetExternalLink, AiAdapterConfig]),
    AiProviderSupportModule,
    AssetsModule,
    ItOpsSettingsModule,
    TechnologiesModule,
    // Sub-locations are written through LocationsService only: uniqueness,
    // display order and the audit trail stay in one place, and the netbox
    // module never runs its own INSERT on location_sub_items.
    LocationsModule,
    ScheduledTasksModule,
    // PermissionsModule brings PermissionGuard and StripeConfigService, which
    // the scheduled run uses to skip frozen tenants (a no-op on-premise).
    PermissionsModule,
    forwardRef(() => UsersModule),
  ],
  providers: [NetboxClient, NetboxConfigService, NetboxSyncService, NetboxScheduledSyncService],
  controllers: [NetboxController],
  exports: [NetboxConfigService, NetboxSyncService],
})
export class NetboxModule {}
