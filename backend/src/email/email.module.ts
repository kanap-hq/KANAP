import { Module } from '@nestjs/common';
import { StorageModule } from '../common/storage/storage.module';
import { EmailService } from './email.service';

@Module({
  // Storage: the tenant logo of the e-mails EmailService builds itself (password reset, invitation).
  imports: [StorageModule],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
