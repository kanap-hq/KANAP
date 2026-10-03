import { Module } from '@nestjs/common';
import { CurrencyModule } from '../../currency/currency.module';
import { BudgetFileService } from './budget-file.service';

/** Shared by the OPEX and CAPEX lists. It does not import either module. */
@Module({
  imports: [CurrencyModule],
  providers: [BudgetFileService],
  exports: [BudgetFileService],
})
export class BudgetFileModule {}
