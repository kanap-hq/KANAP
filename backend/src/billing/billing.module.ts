import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subscription } from './subscription.entity';
import { BillingService } from './billing.service';
import { User } from '../users/user.entity';
import { Tenant } from '../tenants/tenant.entity';
import { BillingController } from './billing.controller';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';
import { EmailModule } from '../email/email.module';
import { StripeClientService, StripeConfigService } from './stripe';
import { StripeWebhookService } from './stripe-webhook.service';
import { StripeWebhookController } from './stripe-webhook.controller';
import { AuditModule } from '../audit/audit.module';
import { TrialMailsModule } from '../email/trial-mails/trial-mails.module';

@Module({
  imports: [TypeOrmModule.forFeature([Subscription, User, Tenant]), PermissionsModule, forwardRef(() => UsersModule), EmailModule, AuditModule, TrialMailsModule],
  providers: [BillingService, StripeConfigService, StripeClientService, StripeWebhookService],
  controllers: [BillingController, StripeWebhookController],
  exports: [BillingService, StripeClientService, StripeConfigService, StripeWebhookService],
})
export class BillingModule {}
