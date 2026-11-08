import { Module, forwardRef } from '@nestjs/common';
import { DemoDataModule } from '../demo-data/demo-data.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

// The onboarding of a workspace: its angle and mode, each user's first steps (`doc/onboarding.md`).
@Module({
  // PermissionGuard (the showcase application) and its dependencies.
  imports: [DemoDataModule, PermissionsModule, forwardRef(() => UsersModule)],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
