// Shared domain types and fixed option lists. All financial data lives in the database.

export type BudgetCat = { k: string; oct: number; sep: number; budget: number; owner: string }; // oct = spent this month, sep = spent last month

export type TxStatus = "Cleared" | "Pending" | "Flagged" | "Failed" | "Reviewed";
export type Tx = { id: string; name: string; memo: string; cat: string; date: string; amt: number; status: TxStatus; method: string };

export const STATUS_TONE: Record<TxStatus, string> = { Cleared: "ok", Pending: "info", Flagged: "warn", Failed: "err", Reviewed: "ok" };
export const TX_CATEGORIES = [
  "Sales", "Services", "Other income",
  "Payroll", "Cost of services", "Contractors", "Rent & Utilities", "Marketing", "Software", "Insurance & fees", "Travel", "Office", "Other expense",
];
export const PAY_METHODS = ["Bank transfer", "Card", "Cash", "Mobile money", "Other"];

export type Goal = { id: string; type: string; name: string; cur: number; target: number; start: number; date: string; down?: boolean; status: "On track" | "Behind pace" | "Not started"; ai: string };
export type Project = { id: string; name: string; desc: string; chats: string[]; docs: string[]; reports: string[]; updated: string };
export type Task = { id: string; name: string; prompt: string; freq: string; next: string; last: string; lastFailed?: boolean; on: boolean };

export type User = { id: string; email: string; name: string; company: string; role: string };

export interface FinancialSummary {
  hasData: boolean;
  cash: number;
  months: string[];
  rev: number[];
  exp: number[];
  net: number[];
  periodLabel: string;
  previousLabel: string;
  incomeByCat: { current: Record<string, number>; previous: Record<string, number> };
  expenseByCat: { current: Record<string, number>; previous: Record<string, number> };
  summary: { revenue: number; expenses: number; net: number; avgMonthlyExpenses: number; runwayMonths: number | null };
}

/** Integrations planned for later. None of these are connected yet. */
export const INTEGRATIONS = [
  { id: "qb", name: "QuickBooks Online", kind: "Accounting" },
  { id: "xero", name: "Xero", kind: "Accounting" },
  { id: "bank", name: "Bank feed", kind: "Banking" },
  { id: "stripe", name: "Stripe", kind: "Payments" },
  { id: "gusto", name: "Gusto", kind: "Payroll" },
];
