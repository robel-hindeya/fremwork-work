import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { Ctx } from '../../common/decorators/user-context.decorator';
import { UserContext, fromMinor } from '../../common/data/db';
import { FinancialFigures, FinancialService, pct } from '../ledger/financial.service';
import { BudgetsService } from '../budgets/budgets.service';
import type { Budget, Insight } from '@fremwork/types';

const money = (minor: number) => `$${fromMinor(Math.abs(minor)).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

type OverviewInsight = Pick<Insight, 'kind' | 'title' | 'body' | 'severity'>;

/** Plain observations computed from the ledger; nothing here is generated or estimated. */
export function insightsFrom(f: FinancialFigures, budgets: Budget[]): OverviewInsight[] {
  const out: OverviewInsight[] = [];
  if (!f.hasData) return out;

  // Largest month-over-month rise in an expense category.
  let rise: { cat: string; now: number; before: number } | null = null;
  for (const [cat, now] of Object.entries(f.expensesByCategory.current)) {
    const before = f.expensesByCategory.previous[cat] ?? 0;
    if (before > 0 && now > before * 1.25 && (!rise || now - before > rise.now - rise.before)) rise = { cat, now, before };
  }
  if (rise) {
    out.push({
      kind: 'unusual expense',
      title: `${rise.cat} up ${pct(rise.now - rise.before, rise.before)}% on ${f.previous.label}`,
      body: `${money(rise.now)} in ${f.current.label} against ${money(rise.before)} the month before.`,
      severity: 'err',
    });
  }

  const revNow = f.current.revenueMinor;
  const revBefore = f.previous.revenueMinor;
  if (revBefore > 0 && revNow !== revBefore) {
    const change = pct(revNow - revBefore, revBefore);
    out.push({
      kind: 'revenue change',
      title: `Revenue ${change > 0 ? 'grew' : 'fell'} ${Math.abs(change)}% month over month`,
      body: `${money(revNow)} in ${f.current.label} against ${money(revBefore)} in ${f.previous.label}.`,
      severity: change > 0 ? 'ok' : 'warn',
    });
  }

  if (f.runwayMonths !== null && f.runwayMonths < 6) {
    out.push({
      kind: 'cash risk',
      title: `About ${f.runwayMonths} months of runway`,
      body: `${money(f.cashOnHandMinor)} cash against average monthly expenses of ${money(f.avgMonthlyExpensesMinor)}.`,
      severity: f.runwayMonths < 3 ? 'err' : 'warn',
    });
  }

  const over = budgets.filter((b) => (b.spentMinor ?? 0) > b.amountMinor);
  if (over.length) {
    const extra = over.reduce((a, b) => a + (b.spentMinor ?? 0) - b.amountMinor, 0);
    out.push({
      kind: 'saving',
      title: `${over.length} ${over.length === 1 ? 'budget is' : 'budgets are'} over this month`,
      body: `${over.map((b) => b.categoryName).join(', ')}: ${money(extra)} above budget in total.`,
      severity: 'info',
    });
  }
  return out;
}

@ApiTags('Overview')
@ApiBearerAuth()
@Controller('overview')
@UseGuards(AuthGuard, WorkspaceGuard)
export class OverviewController {
  constructor(
    private readonly financial: FinancialService,
    private readonly budgets: BudgetsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Overview KPIs, six-month trend and ledger insights. `period` is YYYY-MM (default: this month).' })
  async getOverview(@Ctx() ctx: UserContext, @Query('period') period?: string) {
    const [f, budgets] = await Promise.all([this.financial.figures(ctx, period || undefined), this.budgets.findAll(ctx)]);
    const net = f.current.revenueMinor - f.current.expensesMinor;
    const trend = f.months.slice(-6);
    return {
      success: true,
      data: {
        workspaceId: ctx.user.id,
        hasData: f.hasData,
        period: new Date(`${f.current.key}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
        cashMinor: f.cashOnHandMinor,
        runwayMonths: f.runwayMonths,
        kpis: {
          totalRevenueMinor: f.current.revenueMinor,
          totalExpensesMinor: f.current.expensesMinor,
          netProfitMinor: net,
          operatingCashFlowMinor: f.operatingCashFlowMinor,
          netMarginPct: pct(net, f.current.revenueMinor),
        },
        monthlySeries: {
          months: trend.map((m) => m.label),
          revenueMinor: trend.map((m) => m.revenueMinor),
          expensesMinor: trend.map((m) => m.expensesMinor),
        },
        flaggedCount: f.flaggedCount,
        pendingCount: f.pendingCount,
        insights: insightsFrom(f, budgets),
      },
    };
  }
}
