import { TransactionsRepo } from "../repositories/transactions";
import { BudgetsRepo } from "../repositories/budgets";
import { FinancialService } from "../services/analytics";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, string>;
  execute: (args: any) => Promise<any> | any;
}

export const FINANCIAL_AGENT_TOOLS: Record<string, ToolDefinition> = {
  searchTransactions: {
    name: "searchTransactions",
    description: "Search or filter company transactions from the ledger.",
    parameters: {
      search: "Optional search keyword for payee name, memo, or ID",
      category: "Optional transaction category (e.g., Software, Payroll, Travel)",
      limit: "Max number of transactions to return (default 10)",
    },
    execute: async (args) => {
      const items = await TransactionsRepo.getAll({
        search: args.search,
        cat: args.category,
        limit: Math.min(100, Math.max(1, Math.floor(Number(args.limit) || 10))),
      });
      return {
        count: items.length,
        transactions: items.map((t) => ({
          id: t.id,
          name: t.name,
          amount: t.amt,
          category: t.cat,
          date: t.date,
          memo: t.memo,
          status: t.status,
        })),
      };
    },
  },



  getFinancialHealth: {
    name: "getFinancialHealth",
    description: "Get real-time cash balance, burn rate, runway months, revenue, expenses, and net margin.",
    parameters: {},
    execute: async () => {
      const metrics = await FinancialService.getMetrics();
      const budgets = await BudgetsRepo.getAll();
      const overBudgets = budgets.filter((b) => b.oct > b.budget);
      const { revenue, expenses, net, runwayMonths } = metrics.summary;

      return {
        hasData: metrics.hasData,
        period: metrics.periodLabel,
        cashOnHand: metrics.cash,
        revenue,
        expenses,
        netProfit: net,
        netMarginPct: revenue ? +((net / revenue) * 100).toFixed(1) : null,
        runwayMonths,
        budgetAlerts: overBudgets.map((b) => ({
          category: b.k,
          budget: b.budget,
          actual: b.oct,
          overBy: b.oct - b.budget,
        })),
      };
    },
  },

  getBudgetsStatus: {
    name: "getBudgetsStatus",
    description: "List all department budgets and their utilization percentage.",
    parameters: {},
    execute: async () => {
      const list = await BudgetsRepo.getAll();
      return list.map((b) => ({
        category: b.k,
        budget: b.budget,
        actualSpent: b.oct,
        utilizedPct: +((b.oct / (b.budget || 1)) * 100).toFixed(1),
        owner: b.owner,
        status: b.oct > b.budget ? "Over Budget" : b.oct / b.budget >= 0.9 ? "Near Limit" : "On Track",
      }));
    },
  },





  runScenarioAnalysis: {
    name: "runScenarioAnalysis",
    description: "Simulate runway impact under hiring, spending increase, or revenue drops.",
    parameters: {
      monthlyCostChange: "Monthly change in expenses (+ for new hire, - for savings)",
      monthlyRevenueChange: "Monthly change in revenue (+ for expansion, - for churn)",
    },
    execute: async (args) => {
      const metrics = await FinancialService.getMetrics();
      const currentCash = metrics.cash;
      const { avgMonthlyExpenses: baseMonthlyBurn, runwayMonths: baseRunway } = metrics.summary;

      const dCost = Number(args.monthlyCostChange || 0);
      const dRev = Number(args.monthlyRevenueChange || 0);

      // Same basis as the dashboard's runway: cash divided by average monthly expenses.
      const projectedBurn = baseMonthlyBurn + dCost - dRev;
      const newRunway = projectedBurn > 0 ? (currentCash > 0 ? +(currentCash / projectedBurn).toFixed(1) : 0) : "Cash flow positive";

      return {
        currentCash,
        baseMonthlyBurn,
        projectedMonthlyBurn: projectedBurn,
        currentRunwayMonths: baseRunway,
        projectedRunwayMonths: newRunway,
        differenceMonths: typeof newRunway === "number" && baseRunway !== null ? +(newRunway - baseRunway).toFixed(1) : "N/A",
      };
    },
  },
};
