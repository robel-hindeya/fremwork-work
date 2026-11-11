import { Injectable } from '@nestjs/common';
import { UserContext, badRequest, monthKey, selectAll, toMinor, validDate } from '../../common/data/db';

interface LedgerRow {
  id: string;
  amt: number;
  cat: string;
  date: string;
  status: string;
}

export interface MonthFigures {
  key: string; // YYYY-MM
  label: string; // "Oct 26"
  revenueMinor: number;
  expensesMinor: number;
}

export interface FinancialFigures {
  hasData: boolean;
  /** Cleared money in minus money out, all time. Pending items aren't cash yet; failed ones never count. */
  cashOnHandMinor: number;
  months: MonthFigures[]; // oldest first, ending with the current month
  current: MonthFigures;
  previous: MonthFigures;
  expensesByCategory: { current: Record<string, number>; previous: Record<string, number> };
  incomeByCategory: { current: Record<string, number>; previous: Record<string, number> };
  /** Net of cleared items in the current month. */
  operatingCashFlowMinor: number;
  /** Average of the last three months that had any expenses. */
  avgMonthlyExpensesMinor: number;
  avgMonthlyRevenueMinor: number;
  runwayMonths: number | null;
  flaggedCount: number;
  pendingCount: number;
}

const label = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });

/** All money figures are derived from the user's own ledger. Failed payments never count. */
@Injectable()
export class FinancialService {
  private async ledger(ctx: UserContext, range?: { from?: string; to?: string }): Promise<LedgerRow[]> {
    return selectAll((from, to) => {
      let q = ctx.db.from('ledger_transactions').select('id,amt,cat,date,status').eq('user_id', ctx.user.id).neq('status', 'Failed');
      if (range?.from) q = q.gte('date', range.from);
      if (range?.to) q = q.lte('date', range.to);
      return q.order('id').range(from, to);
    }, 'Read ledger');
  }

  /** `anchor` (YYYY-MM) picks the "current" month; it defaults to this month. */
  async figures(ctx: UserContext, anchor?: string, monthsBack = 12): Promise<FinancialFigures> {
    const now = new Date();
    let end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    if (anchor) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(anchor)) badRequest('period must be a month (YYYY-MM).', 'period');
      end = new Date(`${anchor}-01T00:00:00Z`);
    }
    const window = Array.from({ length: monthsBack }, (_, i) => new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - monthsBack + 1 + i, 1)));
    const months: MonthFigures[] = window.map((d) => ({ key: monthKey(d), label: label(d), revenueMinor: 0, expensesMinor: 0 }));
    const byKey = new Map(months.map((m) => [m.key, m]));
    const current = months[months.length - 1];
    const previous = months[months.length - 2] ?? { key: '', label: '', revenueMinor: 0, expensesMinor: 0 };

    const expensesByCategory = { current: {} as Record<string, number>, previous: {} as Record<string, number> };
    const incomeByCategory = { current: {} as Record<string, number>, previous: {} as Record<string, number> };
    let cashOnHandMinor = 0;
    let operatingCashFlowMinor = 0;
    let flaggedCount = 0;
    let pendingCount = 0;

    const all = await this.ledger(ctx);
    for (const tx of all) {
      const cents = toMinor(tx.amt);
      const key = String(tx.date).slice(0, 7);
      if (tx.status === 'Flagged') flaggedCount++;
      if (tx.status === 'Pending') pendingCount++;
      else {
        cashOnHandMinor += cents;
        if (key === current.key) operatingCashFlowMinor += cents;
      }

      const month = byKey.get(key);
      if (month) {
        if (cents > 0) month.revenueMinor += cents;
        else month.expensesMinor -= cents;
      }
      const bucket = key === current.key ? 'current' : key === previous.key ? 'previous' : null;
      if (bucket) {
        const target = cents > 0 ? incomeByCategory[bucket] : expensesByCategory[bucket];
        target[tx.cat] = (target[tx.cat] ?? 0) + Math.abs(cents);
      }
    }

    const recent = months.slice(-3);
    const avg = (values: number[]) => {
      const nonzero = values.filter((v) => v > 0);
      return nonzero.length ? Math.round(nonzero.reduce((a, b) => a + b, 0) / nonzero.length) : 0;
    };
    const avgMonthlyExpensesMinor = avg(recent.map((m) => m.expensesMinor));
    const avgMonthlyRevenueMinor = avg(recent.map((m) => m.revenueMinor));

    return {
      hasData: all.length > 0,
      cashOnHandMinor,
      months,
      current,
      previous,
      expensesByCategory,
      incomeByCategory,
      operatingCashFlowMinor,
      avgMonthlyExpensesMinor,
      avgMonthlyRevenueMinor,
      runwayMonths: avgMonthlyExpensesMinor > 0 && cashOnHandMinor > 0 ? +(cashOnHandMinor / avgMonthlyExpensesMinor).toFixed(1) : null,
      flaggedCount,
      pendingCount,
    };
  }

  /** Revenue, expenses and the expense mix over a date range (inclusive). */
  async range(ctx: UserContext, from: string, to: string) {
    if (!validDate(from) || !validDate(to)) badRequest('from and to must be dates (YYYY-MM-DD).');
    if (from > to) badRequest('from must be on or before to.');
    const all = await this.ledger(ctx, { from, to });
    let revenueMinor = 0;
    let expensesMinor = 0;
    let operatingCashFlowMinor = 0;
    const byCategory: Record<string, number> = {};
    for (const tx of all) {
      const cents = toMinor(tx.amt);
      if (cents > 0) revenueMinor += cents;
      else {
        expensesMinor -= cents;
        byCategory[tx.cat] = (byCategory[tx.cat] ?? 0) - cents;
      }
      if (tx.status !== 'Pending') operatingCashFlowMinor += cents;
    }
    return { count: all.length, revenueMinor, expensesMinor, operatingCashFlowMinor, byCategory };
  }
}

/** Percentage with one decimal, or 0 when the base is zero. */
export const pct = (part: number, whole: number) => (whole ? +((part / whole) * 100).toFixed(1) : 0);
