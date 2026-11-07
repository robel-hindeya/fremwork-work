import { db } from "../db";
import type { FinancialSummary } from "@/lib/data";

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export const FinancialService = {
  /** Everything here is derived from the transactions table. Failed payments never count. */
  async getMetrics(): Promise<FinancialSummary> {
    const rows = await db.selectAll("ledger_transactions", { select: "id,amt,cat,date,status", status: "neq.Failed", order: "id" });

    const now = new Date();
    const window = Array.from({ length: 12 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - 11 + i, 1));
    const keys = window.map(monthKey);
    const rev = keys.map(() => 0);
    const exp = keys.map(() => 0);

    const current = keys[11];
    const previous = keys[10];
    const incomeByCat: FinancialSummary["incomeByCat"] = { current: {}, previous: {} };
    const expenseByCat: FinancialSummary["expenseByCat"] = { current: {}, previous: {} };
    let cash = 0;

    for (const tx of rows) {
      const amt = Number(tx.amt);
      const key = String(tx.date).slice(0, 7);
      if (tx.status !== "Pending") cash += amt;

      const i = keys.indexOf(key);
      if (i >= 0) (amt > 0 ? rev : exp)[i] += Math.abs(amt);

      const bucket = key === current ? "current" : key === previous ? "previous" : null;
      if (bucket) {
        const target = amt > 0 ? incomeByCat[bucket] : expenseByCat[bucket];
        target[tx.cat] = (target[tx.cat] || 0) + Math.abs(amt);
      }
    }

    const recent = exp.slice(-3).filter((v) => v > 0);
    const avgMonthlyExpenses = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
    const label = (d: Date, opts: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-US", opts);

    return {
      hasData: rows.length > 0,
      cash,
      months: window.map((d) => label(d, { month: "short", year: "2-digit" })),
      rev,
      exp,
      net: rev.map((r, i) => r - exp[i]),
      periodLabel: label(window[11], { month: "long", year: "numeric" }),
      previousLabel: label(window[10], { month: "long", year: "numeric" }),
      incomeByCat,
      expenseByCat,
      summary: {
        revenue: rev[11],
        expenses: exp[11],
        net: rev[11] - exp[11],
        avgMonthlyExpenses,
        runwayMonths: avgMonthlyExpenses > 0 && cash > 0 ? +(cash / avgMonthlyExpenses).toFixed(1) : null,
      },
    };
  },
};
