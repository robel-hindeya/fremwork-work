import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [LedgerModule],
  controllers: [AnalyticsController],
})
export class AnalyticsModule {}
