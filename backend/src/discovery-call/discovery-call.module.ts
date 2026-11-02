import { Module } from '@nestjs/common';
import { DiscoveryCallController } from './discovery-call.controller';
import { DiscoveryCallService } from './discovery-call.service';

// The discovery call of trial workspaces: button clicks, the Cal.com webhook, the call's date (`doc/discovery-call.md`).
@Module({
  controllers: [DiscoveryCallController],
  providers: [DiscoveryCallService],
  exports: [DiscoveryCallService],
})
export class DiscoveryCallModule {}
