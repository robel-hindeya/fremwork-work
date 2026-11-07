import { db, pick, quoted } from "../db";
import type { Tx, TxStatus } from "@/lib/data";

export interface TransactionRecord extends Tx {
  note?: string;
  created_at?: string;
}

const TABLE = "ledger_transactions";
const EDITABLE = ["name", "memo", "cat", "date", "amt", "status", "method", "note"] as const;

const toRecord = (r: any): TransactionRecord => ({
  id: r.id,
  name: r.name,
  memo: r.memo,
  cat: r.cat,
  date: r.date,
  amt: Number(r.amt),
  status: r.status as TxStatus,
  method: r.method,
  note: r.note || undefined,
  created_at: r.created_at,
});

export const TransactionsRepo = {
  async getAll(filter?: { search?: string; cat?: string; status?: string; limit?: number; offset?: number }): Promise<TransactionRecord[]> {
    const params: Record<string, string | number> = { order: "date.desc,id.desc" };
    if (filter?.search) {
      const s = quoted(`*${filter.search}*`);
      params.or = `(name.ilike.${s},memo.ilike.${s},id.ilike.${s})`;
    }
    if (filter?.cat && filter.cat !== "All categories") params.cat = `eq.${filter.cat}`;
    if (filter?.status && filter.status !== "All") params.status = `eq.${filter.status}`;

    if (!filter?.limit) return (await db.selectAll(TABLE, params)).map(toRecord);
    return (await db.select(TABLE, { ...params, limit: filter.limit, offset: filter.offset ?? 0 })).map(toRecord);
  },

  async getById(id: string): Promise<TransactionRecord | null> {
    const r = await db.first(TABLE, { id: `eq.${id}` });
    return r && toRecord(r);
  },

  async create(data: Omit<TransactionRecord, "id"> & { id?: string }): Promise<TransactionRecord> {
    const row = await db.insert(TABLE, {
      id: data.id || `TX-${crypto.randomUUID().slice(0, 13).replace("-", "").toUpperCase()}`,
      name: data.name,
      memo: data.memo,
      cat: data.cat,
      date: data.date,
      amt: data.amt,
      status: data.status || "Cleared",
      method: data.method || "Other",
      note: data.note || null,
    });
    return toRecord(row);
  },

  async update(id: string, patch: Partial<TransactionRecord>): Promise<TransactionRecord | null> {
    const r = await db.update(TABLE, { id: `eq.${id}` }, pick(patch, EDITABLE));
    return r && toRecord(r);
  },

  async delete(id: string): Promise<boolean> {
    return (await db.remove(TABLE, { id: `eq.${id}` })) > 0;
  },
};
