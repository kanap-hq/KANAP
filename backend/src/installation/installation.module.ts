import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiProviderSupportModule } from '../ai/ai-provider-support.module';
import { AuditModule } from '../audit/audit.module';
import { UserRole } from '../users/user-role.entity';
import { InstallationAiSettings } from './installation-ai-settings.entity';
import { InstallationSettingsController } from './installation-settings.controller';
import { InstallationSettingsService } from './installation-settings.service';

/** The settings of the installation (the file, else the database, else the default) and their page. */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([InstallationAiSettings, UserRole]), AuditModule, AiProviderSupportModule],
  providers: [InstallationSettingsService],
  controllers: [InstallationSettingsController],
  exports: [InstallationSettingsService],
})
export class InstallationModule {}
