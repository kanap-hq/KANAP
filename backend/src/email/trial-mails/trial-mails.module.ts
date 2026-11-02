import { Module } from '@nestjs/common';
import { DiscoveryCallModule } from '../../discovery-call/discovery-call.module';
import { EmailModule } from '../email.module';
import { TrialMailsController } from './trial-mails.controller';
import { TrialMailsService } from './trial-mails.service';

// The trial e-mails and their scheduler, cloud only (`doc/trial-mails.md`).
@Module({
  imports: [EmailModule, DiscoveryCallModule],
  controllers: [TrialMailsController],
  providers: [TrialMailsService],
  exports: [TrialMailsService],
})
export class TrialMailsModule {}
