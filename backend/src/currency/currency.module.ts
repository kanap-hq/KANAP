import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CurrencyRateSet } from './currency-rate-set.entity';
import { CurrencySettingsService } from './currency-settings.service';
import { FxRateService } from './fx-rate.service';
import { Tenant } from '../tenants/tenant.entity';
import { FxIngestionService } from './fx-ingestion.service';
import { ManualRatesService } from './manual-rates.service';
import { WorldBankClient } from './world-bank-client';
import { CurrencyController } from './currency.controller';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CurrencyRateSet, Tenant]),
    PermissionsModule,
    forwardRef(() => UsersModule),
    AuditModule,
  ],
  controllers: [CurrencyController],
  providers: [CurrencySettingsService, FxRateService, WorldBankClient, FxIngestionService, ManualRatesService],
  // ManualRatesService: Plaid and the MCP read the rate matrix and the missing rates through it.
  exports: [CurrencySettingsService, FxRateService, FxIngestionService, ManualRatesService],
})
export class CurrencyModule {}
