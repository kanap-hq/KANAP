import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health/health.controller';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { CompaniesModule } from './companies/companies.module';
import { DepartmentsModule } from './departments/departments.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { AccountsModule } from './accounts/accounts.module';
import { AuditModule } from './audit/audit.module';
import { SpendModule } from './spend/spend.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { CapexModule } from './capex/capex.module';
import { RolesModule } from './roles/roles.module';
import { ContractsModule } from './contracts/contracts.module';
import { PermissionsModule } from './permissions/permissions.module';
import { BillingModule } from './billing/billing.module';
import { TenantsModule } from './tenants/tenants.module';
import { PublicController } from './public/public.controller';
import { EmailModule } from './email/email.module';
import { TrialSignup } from './public/trial-signup.entity';
import { AdminTenantsModule } from './admin/tenants/admin-tenants.module';
import { FreezeModule } from './freeze/freeze.module';
import { BudgetColumnsModule } from './budget-columns/budget-columns.module';
import { MasterDataOperationsModule } from './master-data/master-data-operations.module';
import { CurrencyModule } from './currency/currency.module';
import { ContactsModule } from './contacts/contacts.module';
import { AdminCoaTemplatesModule } from './admin/coa-templates/admin-coa-templates.module';
import { AdminOpsModule } from './admin/ops/admin-ops.module';
import { AdminBrandingModule } from './admin/branding/admin-branding.module';
import { StorageModule } from './common/storage/storage.module';
import { DocumentExportModule } from './common/document-export.module';
import { TenancyModule } from './common/tenancy';
import { ApplicationsModule } from './applications/applications.module';
import { AppInstancesModule } from './app-instances/app-instances.module';
import { AssetsModule } from './assets/assets.module';
import { IncidentsModule } from './incidents/incidents.module';
import { AppAssetAssignmentsModule } from './app-asset-assignments/app-asset-assignments.module';
import { InterfacesModule } from './interfaces/interfaces.module';
import { InterfaceBindingsModule } from './interface-bindings/interface-bindings.module';
import { ItOpsSettingsModule } from './it-ops-settings/it-ops-settings.module';
import { BusinessProcessesModule } from './business-processes/business-processes.module';
import { LocationsModule } from './locations/locations.module';
import { ConnectionsModule } from './connections/connections.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { TasksModule } from './tasks/tasks.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { RateLimitGuard } from './common/rate-limit.guard';
import { TurnstileService } from './public/turnstile.service';
import { ConfigController } from './config/config.controller';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { AiModule } from './ai/ai.module';
import { PlatformAiModule } from './ai/platform/platform-ai.module';
import { ScheduledTasksModule } from './admin/scheduled-tasks/scheduled-tasks.module';
import { CleanupModule } from './cleanup/cleanup.module';
import { NetboxModule } from './netbox/netbox.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 10,
      },
    ]),
    ScheduleModule.forRoot(),
    TenancyModule,
    TypeOrmModule.forRootAsync({
      useFactory: () => {
        const url = process.env.DATABASE_URL;
        return {
          type: 'postgres',
          url,
          autoLoadEntities: true,
          synchronize: false,
          ssl: false,
          migrationsRun: true,
          migrations: [__dirname + '/migrations/*.{ts,js}'],
          logging: ['error', 'warn'],
          applicationName: process.env.DB_APP_NAME || 'cio-api',
          extra: {
            max: parseInt(process.env.DB_POOL_MAX || '20', 10),
            min: parseInt(process.env.DB_POOL_MIN || '2', 10),
            idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000', 10),
            connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT || '10000', 10),
            application_name: process.env.DB_APP_NAME || 'cio-api',
          },
        } as any;
      },
    }),
    UsersModule,
    AuthModule,
    EmailModule,
    AuditModule,
    CompaniesModule,
    DepartmentsModule,
    SuppliersModule,
    AccountsModule,
    SpendModule,
    AnalyticsModule,
    CapexModule,
    RolesModule,
    ContractsModule,
    PermissionsModule,
    BillingModule,
    TenantsModule,
    AdminTenantsModule,
    AdminCoaTemplatesModule,
    AdminOpsModule,
    AdminBrandingModule,
    FreezeModule,
    BudgetColumnsModule,
    CurrencyModule,
    ContactsModule,
    MasterDataOperationsModule,
    TypeOrmModule.forFeature([TrialSignup]),
    StorageModule,
    ApplicationsModule,
    AppInstancesModule,
    AssetsModule,
    IncidentsModule,
    AppAssetAssignmentsModule,
    InterfacesModule,
    InterfaceBindingsModule,
    ConnectionsModule,
    ItOpsSettingsModule,
    BusinessProcessesModule,
    LocationsModule,
    PortfolioModule,
    TasksModule,
    DashboardModule,
    NotificationsModule,
    KnowledgeModule,
    DocumentExportModule,
    PlatformAiModule,
    AiModule,
    ScheduledTasksModule,
    CleanupModule,
    NetboxModule,
  ],
  controllers: [HealthController, PublicController, ConfigController],
  providers: [RateLimitGuard, TurnstileService],
})
export class AppModule {}
