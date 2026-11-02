import { Module } from '@nestjs/common';
import { PlatformAdminGuard } from '../../auth/platform-admin.guard';
import { DiscoveryCallModule } from '../../discovery-call/discovery-call.module';
import { AdminTrialsController } from './admin-trials.controller';
import { AdminTrialsService } from './admin-trials.service';

// The trial funnel of platform administration (`doc/trial-funnel.md`).
@Module({
  imports: [DiscoveryCallModule],
  controllers: [AdminTrialsController],
  providers: [AdminTrialsService, PlatformAdminGuard],
})
export class AdminTrialsModule {}
