import { AsyncLocalStorage } from "node:async_hooks";
import { SUPABASE_KEY, SUPABASE_URL } from "./auth";

/** The signed-in user for the current request. Their token makes row level security apply. */
export const userScope = new AsyncLocalStorage<{ userId: string; token: string }>();

type Params = Record<string, string | number>;

/** PostgREST never returns more than this many rows at once. */
const PAGE = 1000;

async function call(path: string, params: Params, init: RequestInit = {}): Promise<any> {
  const scope = userScope.getStore();
  if (!scope) throw new Error("No signed-in user for this request.");

  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}?${query}`, {
    ...init,
    cache: "no-store",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${scope.token}`, "Content-Type": "application/json", ...init.headers },
  });
  const body = await res.text();
  const data = body ? JSON.parse(body) : null;
  if (!res.ok) throw new Error(data?.message || `Database error (${res.status})`);
  return data;
}

const RETURN_ROWS = { Prefer: "return=representation" };

/** Quotes a value for use inside a PostgREST `or=(...)` filter. */
export const quoted = (value: string) => `"${value.replace(/[\\"]/g, "\\$&")}"`;

export const db = {
  select: <T = any>(table: string, params: Params = {}): Promise<T[]> => call(table, { select: "*", ...params }),

  /** Every matching row, however many. `params` must set a stable `order`. */
  async selectAll<T = any>(table: string, params: Params): Promise<T[]> {
    const rows: T[] = [];
    for (;;) {
      const page = await db.select<T>(table, { ...params, limit: PAGE, offset: rows.length });
      rows.push(...page);
      if (page.length < PAGE) return rows;
    }
  },

  async first<T = any>(table: string, params: Params): Promise<T | null> {
    return (await db.select<T>(table, { ...params, limit: 1 }))[0] ?? null;
  },

  async insert<T = any>(table: string, row: object): Promise<T> {
    const rows = await call(table, {}, { method: "POST", headers: RETURN_ROWS, body: JSON.stringify(row) });
    return rows[0];
  },

  /** Returns the updated row, or null if nothing matched. */
  async update<T = any>(table: string, filter: Params, patch: object): Promise<T | null> {
    if (Object.values(patch).every((v) => v === undefined)) return db.first<T>(table, filter);
    const rows = await call(table, filter, { method: "PATCH", headers: RETURN_ROWS, body: JSON.stringify(patch) });
    return rows[0] ?? null;
  },

  /** Returns how many rows were deleted. */
  async remove(table: string, filter: Params): Promise<number> {
    const rows = await call(table, { ...filter, select: "id" }, { method: "DELETE", headers: RETURN_ROWS });
    return rows.length;
  },

  rpc: <T = any>(name: string): Promise<T> => call(`rpc/${name}`, {}, { method: "POST", body: "{}" }),
};

/** Copies only the listed fields, so a request body can't write columns like user_id. */
export function pick<K extends string>(source: Partial<Record<K, unknown>>, keys: readonly K[]) {
  return Object.fromEntries(keys.map((k) => [k, source[k]]));
}
