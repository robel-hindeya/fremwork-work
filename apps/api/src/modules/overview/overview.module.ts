import { Module } from '@nestjs/common';
import { OverviewController } from './overview.controller';
import { LedgerModule } from '../ledger/ledger.module';
import { BudgetsModule } from '../budgets/budgets.module';

@Module({
  imports: [LedgerModule, BudgetsModule],
  controllers: [OverviewController],
})
export class OverviewModule {}
