import { Module } from '@nestjs/common';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';
import { FinancialService } from './financial.service';

@Module({
  controllers: [LedgerController],
  providers: [LedgerService, FinancialService],
  exports: [LedgerService, FinancialService],
})
export class LedgerModule {}
