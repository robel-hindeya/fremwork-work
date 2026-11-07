import { db, pick } from "../db";
import type { BudgetCat } from "@/lib/data";

export interface BudgetRecord extends BudgetCat {
  id: string;
  alert?: string;
  created_at?: string;
}

const TABLE = "ledger_budgets";
const EDITABLE = ["k", "budget", "owner", "alert"] as const;

/** Spending per lower-cased category for one month (YYYY-MM), from the ledger. */
async function spentIn(month: string): Promise<Record<string, number>> {
  const rows = await db.selectAll("ledger_transactions", {
    select: "id,cat,amt",
    amt: "lt.0",
    status: "neq.Failed",
    date: `like.${month}*`,
    order: "id",
  });
  const spent: Record<string, number> = {};
  for (const r of rows) {
    const cat = r.cat.toLowerCase();
    spent[cat] = (spent[cat] ?? 0) - Number(r.amt);
  }
  return spent;
}

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const toRecord = (r: any, thisMonth: Record<string, number> = {}, lastMonth: Record<string, number> = {}): BudgetRecord => ({
  id: r.id,
  k: r.k,
  oct: thisMonth[r.k.toLowerCase()] ?? 0,
  sep: lastMonth[r.k.toLowerCase()] ?? 0,
  budget: Number(r.budget),
  owner: r.owner,
  alert: r.alert,
  created_at: r.created_at,
});

export const BudgetsRepo = {
  async getAll(): Promise<BudgetRecord[]> {
    const now = new Date();
    const [rows, thisMonth, lastMonth] = await Promise.all([
      db.selectAll(TABLE, { order: "budget.desc,id" }),
      spentIn(monthKey(now)),
      spentIn(monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1))),
    ]);
    return rows.map((r) => toRecord(r, thisMonth, lastMonth));
  },

  async create(data: { k: string; budget: number; owner: string; alert?: string }): Promise<BudgetRecord> {
    const row = await db.insert(TABLE, {
      id: `b-${Date.now().toString(36)}`,
      k: data.k,
      budget: data.budget,
      owner: data.owner,
      alert: data.alert || "90% of budget",
    });
    return toRecord(row);
  },

  async update(id: string, patch: Partial<BudgetRecord>): Promise<BudgetRecord | null> {
    const r = await db.update(TABLE, { id: `eq.${id}` }, pick(patch, EDITABLE));
    return r && toRecord(r);
  },

  async delete(id: string): Promise<boolean> {
    return (await db.remove(TABLE, { id: `eq.${id}` })) > 0;
  },
};
