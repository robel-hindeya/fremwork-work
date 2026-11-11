import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { Ctx } from '../../common/decorators/user-context.decorator';
import type { UserContext } from '../../common/data/db';
import { FinancialService, pct } from '../ledger/financial.service';

const TOP_CATEGORIES = 6;

/** The first day of the month eleven months ago, and today: the last twelve months. */
function defaultRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  return { from: start.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
}

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics')
@UseGuards(AuthGuard, WorkspaceGuard)
export class AnalyticsController {
  constructor(private readonly financial: FinancialService) {}

  @Get()
  @ApiOperation({ summary: 'Revenue, expenses and expense mix over a date range (default: last 12 months)' })
  async getAnalytics(@Ctx() ctx: UserContext, @Query('from') from?: string, @Query('to') to?: string) {
    const range = { ...defaultRange(), ...(from ? { from } : {}), ...(to ? { to } : {}) };
    const r = await this.financial.range(ctx, range.from, range.to);
    const net = r.revenueMinor - r.expensesMinor;

    const sorted = Object.entries(r.byCategory).sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, TOP_CATEGORIES);
    const other = sorted.slice(TOP_CATEGORIES).reduce((a, [, v]) => a + v, 0);
    const expenseBreakdown = [...top, ...(other > 0 ? [['Other', other] as [string, number]] : [])].map(([category, amountMinor]) => ({
      category,
      amountMinor,
      sharePct: pct(amountMinor, r.expensesMinor),
    }));

    return {
      success: true,
      data: {
        workspaceId: ctx.user.id,
        hasData: r.count > 0,
        dateRange: range,
        totals: {
          revenueMinor: r.revenueMinor,
          expensesMinor: r.expensesMinor,
          netProfitMinor: net,
          operatingCashFlowMinor: r.operatingCashFlowMinor,
          netMarginPct: pct(net, r.revenueMinor),
        },
        expenseBreakdown,
      },
    };
  }
}
