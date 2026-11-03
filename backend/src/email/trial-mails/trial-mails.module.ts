import { Module } from '@nestjs/common';
import { StripeConfigService } from '../../billing/stripe/stripe.config';
import { DiscoveryCallModule } from '../../discovery-call/discovery-call.module';
import { EmailModule } from '../email.module';
import { TrialMailsController } from './trial-mails.controller';
import { TrialMailsService } from './trial-mails.service';

// The trial e-mails and their scheduler, cloud only (`doc/trial-mails.md`).
@Module({
  imports: [EmailModule, DiscoveryCallModule],
  controllers: [TrialMailsController],
  // StripeConfigService reads the environment only; provided here, as PermissionsModule does,
  // because BillingModule imports this module (the webhook's thank-you).
  providers: [TrialMailsService, StripeConfigService],
  exports: [TrialMailsService],
})
export class TrialMailsModule {}
