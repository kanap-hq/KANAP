import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { PermissionGuard } from './permission.guard';
import { PermissionsModule } from '../permissions/permissions.module';
import { BillingModule } from '../billing/billing.module';
import { EmailModule } from '../email/email.module';
import { CurrencyModule } from '../currency/currency.module';
import { TenantsModule } from '../tenants/tenants.module';
import { EntraAuthModule } from './entra-auth.module';
import { EntraController } from './entra.controller';
import { AdminAuthController } from './admin-auth.controller';
import { EntraDirectorySyncService } from './entra-directory-sync.service';
import { RefreshToken } from './refresh-token.entity';
import { PasswordResetToken } from './password-reset-token.entity';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PortfolioModule } from '../portfolio/portfolio.module';

@Module({
  imports: [
    ConfigModule,
    // No ThrottlerModule here: RateLimitGuard counts in the one storage of app.module.ts (the
    // database with several API processes), like every other rate-limited route.
    TypeOrmModule.forFeature([RefreshToken, PasswordResetToken]),
    UsersModule,
    PermissionsModule,
    BillingModule,
    EmailModule,
    CurrencyModule,
    TenantsModule,
    EntraAuthModule,
    AuditModule,
    NotificationsModule,
    // The directory sync writes the contributor reporting line.
    PortfolioModule,
  ],
  providers: [AuthService, JwtAuthGuard, RolesGuard, PermissionGuard, RateLimitGuard, EntraDirectorySyncService],
  controllers: [AuthController, EntraController, AdminAuthController],
  exports: [JwtAuthGuard, RolesGuard, PermissionGuard, AuthService],
})
export class AuthModule {}
