import { db } from "../db";
import type { Task } from "@/lib/data";

export interface TaskRecord extends Task {
  created_at?: string;
}

const TABLE = "ledger_tasks";

const toRecord = (r: any): TaskRecord => ({
  id: r.id,
  name: r.name,
  prompt: r.prompt,
  freq: r.freq,
  next: r.next_run,
  last: r.last_run,
  lastFailed: Boolean(r.last_failed),
  on: Boolean(r.is_on),
  created_at: r.created_at,
});

export const TasksRepo = {
  async getAll(): Promise<TaskRecord[]> {
    return (await db.selectAll(TABLE, { order: "created_at,id" })).map(toRecord);
  },

  async create(data: { name: string; prompt: string; freq: string; next?: string }): Promise<TaskRecord> {
    const row = await db.insert(TABLE, {
      id: `t-${Date.now().toString(36)}`,
      name: data.name,
      prompt: data.prompt,
      freq: data.freq,
      next_run: data.next || "Run manually",
      last_run: "Not run yet",
    });
    return toRecord(row);
  },

  async update(id: string, patch: Partial<{ name: string; prompt: string; freq: string; next: string; last: string; lastFailed: boolean; on: boolean }>): Promise<TaskRecord | null> {
    const r = await db.update(TABLE, { id: `eq.${id}` }, {
      name: patch.name,
      prompt: patch.prompt,
      freq: patch.freq,
      next_run: patch.next,
      last_run: patch.last,
      last_failed: patch.lastFailed,
      is_on: patch.on,
    });
    return r && toRecord(r);
  },

  async delete(id: string): Promise<boolean> {
    return (await db.remove(TABLE, { id: `eq.${id}` })) > 0;
  },
};
