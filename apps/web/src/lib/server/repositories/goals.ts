import { db, pick } from "../db";
import type { Goal } from "@/lib/data";

export interface GoalRecord extends Goal {
  created_at?: string;
}

const TABLE = "ledger_goals";
const EDITABLE = ["type", "name", "cur", "target", "start", "date", "down", "status", "ai"] as const;

const toRecord = (r: any): GoalRecord => ({
  id: r.id,
  type: r.type,
  name: r.name,
  cur: Number(r.cur),
  target: Number(r.target),
  start: Number(r.start),
  date: r.date,
  down: Boolean(r.down),
  status: r.status,
  ai: r.ai,
  created_at: r.created_at,
});

export const GoalsRepo = {
  async getAll(): Promise<GoalRecord[]> {
    return (await db.selectAll(TABLE, { order: "created_at,id" })).map(toRecord);
  },

  async create(data: { type: string; name: string; cur: number; target: number; start?: number; date: string; down?: boolean }): Promise<GoalRecord> {
    const row = await db.insert(TABLE, {
      id: `g-${Date.now().toString(36)}`,
      type: data.type,
      name: data.name,
      cur: data.cur,
      target: data.target,
      start: data.start ?? data.cur,
      date: data.date,
      down: data.down ?? data.type === "Expense reduction",
      status: "On track",
      ai: `Goal established. Tracking pace toward ${data.type.toLowerCase()} of $${data.target.toLocaleString()} by ${data.date}.`,
    });
    return toRecord(row);
  },

  async update(id: string, patch: Partial<GoalRecord>): Promise<GoalRecord | null> {
    const r = await db.update(TABLE, { id: `eq.${id}` }, pick(patch, EDITABLE));
    return r && toRecord(r);
  },

  async delete(id: string): Promise<boolean> {
    return (await db.remove(TABLE, { id: `eq.${id}` })) > 0;
  },
};
