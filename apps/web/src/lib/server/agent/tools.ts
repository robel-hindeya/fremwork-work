import { TransactionsRepo } from "../repositories/transactions";
import { BudgetsRepo } from "../repositories/budgets";
import { GoalsRepo } from "../repositories/goals";
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
        limit: args.limit ? Number(args.limit) : 10,
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

  addTransaction: {
    name: "addTransaction",
    description: "Record a new expense or revenue transaction into the ledger.",
    parameters: {
      name: "Payee or customer name",
      amount: "Amount in USD (positive for income, negative for expense)",
      category: "Category name (Software, Marketing, Travel, Subscriptions, Services, etc.)",
      date: "ISO date YYYY-MM-DD",
      memo: "Description or purpose",
    },
    execute: async (args) => {
      const amt = Number(args.amount);
      const created = await TransactionsRepo.create({
        name: args.name,
        amt,
        cat: args.category || "Other expense",
        date: args.date || new Date().toISOString().split("T")[0],
        memo: args.memo || "Recorded by Fremwork AI Agent",
        method: args.method || "Other",
        status: "Cleared",
      });
      return {
        success: true,
        transaction: created,
        message: `Successfully recorded ${created.id}: ${created.name} for $${Math.abs(created.amt).toLocaleString()}`,
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

  createBudget: {
    name: "createBudget",
    description: "Set a monthly spending budget limit for a category.",
    parameters: {
      category: "Category name",
      budget: "Monthly budget amount in USD",
      owner: "Team or person responsible",
    },
    execute: async (args) => {
      const created = await BudgetsRepo.create({
        k: args.category,
        budget: Number(args.budget),
        owner: args.owner || "Finance Team",
      });
      return {
        success: true,
        budget: created,
        message: `Set monthly budget of $${created.budget.toLocaleString()} for ${created.k}`,
      };
    },
  },

  createGoal: {
    name: "createGoal",
    description: "Create a new financial target (savings, revenue, or expense reduction).",
    parameters: {
      name: "Goal title",
      type: "Savings target | Revenue target | Expense reduction",
      target: "Target dollar amount",
      current: "Current dollar amount",
      date: "Target completion date YYYY-MM-DD",
    },
    execute: async (args) => {
      const created = await GoalsRepo.create({
        name: args.name,
        type: args.type || "Savings target",
        cur: Number(args.current || 0),
        target: Number(args.target),
        date: args.date,
      });
      return {
        success: true,
        goal: created,
        message: `Established goal "${created.name}" targeting $${created.target.toLocaleString()}`,
      };
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
