import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Transaction, TransactionStatus } from '@fremwork/types';
import {
  UserContext, badRequest, dbError, literalLike, minorFrom, quoted, rows, selectAll, text, validDate, validId, defined,
} from '../../common/data/db';

const TABLE = 'ledger_transactions';

/** Stored as Title case (shared with the web workspace); the API speaks lower case. */
const STATUSES: Record<TransactionStatus, string> = {
  cleared: 'Cleared', pending: 'Pending', flagged: 'Flagged', failed: 'Failed', reviewed: 'Reviewed',
};

export interface TransactionFilter {
  type?: 'all' | 'income' | 'expense';
  q?: string;
  from?: string;
  to?: string;
  category?: string;
  limit?: number;
}

export interface TransactionTotals {
  count: number;
  moneyInMinor: number;
  moneyOutMinor: number;
  netMinor: number;
}

export function toTransaction(r: any, userId: string): Transaction {
  const cents = Math.round(Number(r.amt) * 100);
  return {
    id: r.id,
    workspaceId: userId,
    date: r.date,
    amountMinor: cents,
    currency: 'USD',
    payee: r.name,
    memo: r.memo,
    categoryName: r.cat,
    method: r.method,
    status: (String(r.status).toLowerCase() as TransactionStatus),
    note: r.note || undefined,
    createdAt: r.created_at,
    updatedAt: r.created_at,
  };
}

/** Validates an API transaction body and maps it to ledger columns. */
export function transactionColumns(body: unknown, partial: boolean) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) badRequest('Invalid transaction.');
  const data = body as Record<string, any>;

  const cents = minorFrom(data, 'amountMinor', ['amount', 'amt']);
  const name = text(data, ['payee', 'name'], 200);
  const date = text(data, ['date'], 10);
  const statusIn = text(data, ['status'], 20);

  if (!partial) {
    if (!name?.trim()) badRequest('Enter a payee.', 'payee');
    if (cents === undefined) badRequest('Enter an amount (amountMinor in cents, or amount in dollars).', 'amountMinor');
  }
  if (name !== undefined && !name.trim()) badRequest('Enter a payee.', 'payee');
  if (cents === 0) badRequest('Enter a nonzero amount.', 'amountMinor');
  if (date !== undefined && !validDate(date)) badRequest('Enter a valid date (YYYY-MM-DD).', 'date');

  let status: string | undefined;
  if (statusIn !== undefined) {
    status = STATUSES[statusIn.toLowerCase() as TransactionStatus];
    if (!status) badRequest(`Status must be one of: ${Object.keys(STATUSES).join(', ')}.`, 'status');
  }

  return defined({
    name: name?.trim(),
    memo: text(data, ['memo']),
    cat: text(data, ['categoryName', 'cat', 'category'], 100),
    date,
    amt: cents === undefined ? undefined : cents / 100,
    status,
    method: text(data, ['method'], 100),
    note: text(data, ['note']),
  });
}

@Injectable()
export class LedgerService {
  async findAll(ctx: UserContext, filter: TransactionFilter = {}): Promise<{ rows: Transaction[]; totals: TransactionTotals }> {
    if (filter.from && !validDate(filter.from)) badRequest('from must be a date (YYYY-MM-DD).', 'from');
    if (filter.to && !validDate(filter.to)) badRequest('to must be a date (YYYY-MM-DD).', 'to');
    if (filter.type && !['all', 'income', 'expense'].includes(filter.type)) badRequest('type must be all, income or expense.', 'type');

    const all = await selectAll((from, to) => {
      let q = ctx.db.from(TABLE).select('*').eq('user_id', ctx.user.id);
      if (filter.type === 'income') q = q.gt('amt', 0);
      if (filter.type === 'expense') q = q.lt('amt', 0);
      if (filter.category && filter.category !== 'all') q = q.ilike('cat', literalLike(filter.category));
      if (filter.from) q = q.gte('date', filter.from);
      if (filter.to) q = q.lte('date', filter.to);
      if (filter.q?.trim()) {
        const s = quoted(`*${filter.q.trim().slice(0, 200)}*`);
        q = q.or(`name.ilike.${s},memo.ilike.${s},id.ilike.${s}`);
      }
      return q.order('date', { ascending: false }).order('id', { ascending: false }).range(from, to);
    }, 'List transactions');

    const list = all.map((r) => toTransaction(r, ctx.user.id));
    const moneyInMinor = list.filter((t) => t.amountMinor > 0).reduce((a, t) => a + t.amountMinor, 0);
    const moneyOutMinor = list.filter((t) => t.amountMinor < 0).reduce((a, t) => a - t.amountMinor, 0);
    const limit = Math.min(500, Math.max(1, Math.floor(Number(filter.limit) || 100)));
    return {
      rows: list.slice(0, limit),
      totals: { count: list.length, moneyInMinor, moneyOutMinor, netMinor: moneyInMinor - moneyOutMinor },
    };
  }

  async findOne(ctx: UserContext, id: string): Promise<Transaction> {
    if (!validId(id)) throw this.notFound(id);
    const found = rows(await ctx.db.from(TABLE).select('*').eq('user_id', ctx.user.id).eq('id', id).limit(1), 'Read transaction');
    if (!found[0]) throw this.notFound(id);
    return toTransaction(found[0], ctx.user.id);
  }

  async create(ctx: UserContext, body: unknown): Promise<Transaction> {
    const cols = transactionColumns(body, false);
    const requestedId = (body as any).id;
    if (requestedId !== undefined && !validId(requestedId)) badRequest('Invalid transaction id.', 'id');
    const row = {
      id: requestedId || `TX-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`,
      name: cols.name,
      memo: cols.memo ?? '',
      cat: cols.cat || 'Uncategorized',
      date: cols.date ?? new Date().toISOString().slice(0, 10),
      amt: cols.amt,
      status: cols.status ?? 'Cleared',
      method: cols.method || 'Other',
      note: cols.note ?? null,
    };
    const { data, error } = await ctx.db.from(TABLE).insert(row).select('*').single();
    if (error) dbError(error, 'Create transaction');
    return toTransaction(data, ctx.user.id);
  }

  async update(ctx: UserContext, id: string, patch: unknown): Promise<Transaction> {
    if (!validId(id)) throw this.notFound(id);
    const cols = transactionColumns(patch, true);
    if (Object.keys(cols).length === 0) return this.findOne(ctx, id);
    const updated = rows(await ctx.db.from(TABLE).update(cols).eq('user_id', ctx.user.id).eq('id', id).select('*'), 'Update transaction');
    if (!updated[0]) throw this.notFound(id);
    return toTransaction(updated[0], ctx.user.id);
  }

  async delete(ctx: UserContext, id: string): Promise<boolean> {
    if (!validId(id)) return false;
    const deleted = rows(await ctx.db.from(TABLE).delete().eq('user_id', ctx.user.id).eq('id', id).select('id'), 'Delete transaction');
    return deleted.length > 0;
  }

  private notFound(id: string) {
    return new NotFoundException({ code: 'not_found', message: `Transaction ${String(id).slice(0, 100)} not found.` });
  }
}
