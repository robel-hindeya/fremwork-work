import { Injectable, NotFoundException } from '@nestjs/common';
import type { Budget } from '@fremwork/types';
import { UserContext, badRequest, dbError, defined, minorFrom, monthKey, newId, rows, selectAll, text, toMinor, validId } from '../../common/data/db';

const TABLE = 'ledger_budgets';

/** The `alert` column holds text such as "90% of budget"; the API exposes the percentage. */
const alertPct = (alert: unknown) => {
  const n = parseInt(String(alert ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 90;
};

function toBudget(r: any, userId: string, period: string, spent: Record<string, number>): Budget {
  return {
    id: r.id,
    workspaceId: userId,
    categoryId: r.k,
    categoryName: r.k,
    amountMinor: toMinor(r.budget),
    period,
    alertAtPct: alertPct(r.alert),
    ownerLabel: r.owner,
    spentMinor: spent[String(r.k).toLowerCase()] ?? 0,
    createdAt: r.created_at,
  };
}

function budgetColumns(body: unknown, partial: boolean) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) badRequest('Invalid budget.');
  const data = body as Record<string, any>;
  const k = text(data, ['categoryName', 'k', 'category'], 100)?.trim();
  const cents = minorFrom(data, 'amountMinor', ['budget', 'amount']);
  const owner = text(data, ['ownerLabel', 'owner'], 100);
  const pctIn = data.alertAtPct;

  if (!partial && !k) badRequest('Enter a category name.', 'categoryName');
  if (k !== undefined && !k) badRequest('Enter a category name.', 'categoryName');
  if (!partial && cents === undefined) badRequest('Enter a budget amount.', 'amountMinor');
  if (cents !== undefined && cents <= 0) badRequest('The budget must be more than zero.', 'amountMinor');
  if (pctIn !== undefined && (!Number.isInteger(pctIn) || pctIn < 1 || pctIn > 200)) badRequest('alertAtPct must be a whole number from 1 to 200.', 'alertAtPct');

  return defined({
    k,
    budget: cents === undefined ? undefined : cents / 100,
    owner,
    alert: pctIn === undefined ? text(data, ['alert'], 100) : `${pctIn}% of budget`,
  });
}

@Injectable()
export class BudgetsService {
  /** Spending per lower-cased category for one month (YYYY-MM), from the ledger. */
  async spentIn(ctx: UserContext, month: string): Promise<Record<string, number>> {
    const expenses = await selectAll(
      (from, to) => ctx.db.from('ledger_transactions').select('id,cat,amt').eq('user_id', ctx.user.id)
        .lt('amt', 0).neq('status', 'Failed').like('date', `${month}%`).order('id').range(from, to),
      'Read budget spending',
    );
    const spent: Record<string, number> = {};
    for (const r of expenses) {
      const cat = String(r.cat).toLowerCase();
      spent[cat] = (spent[cat] ?? 0) - toMinor(r.amt);
    }
    return spent;
  }

  async findAll(ctx: UserContext): Promise<Budget[]> {
    const period = monthKey(new Date());
    const [list, spent] = await Promise.all([
      selectAll((from, to) => ctx.db.from(TABLE).select('*').eq('user_id', ctx.user.id).order('budget', { ascending: false }).order('id').range(from, to), 'List budgets'),
      this.spentIn(ctx, period),
    ]);
    return list.map((r) => toBudget(r, ctx.user.id, period, spent));
  }

  async create(ctx: UserContext, body: unknown): Promise<Budget> {
    const cols = budgetColumns(body, false);
    const { data, error } = await ctx.db.from(TABLE).insert({
      id: newId('b'),
      k: cols.k,
      budget: cols.budget,
      owner: cols.owner || 'Finance',
      alert: cols.alert || '90% of budget',
    }).select('*').single();
    if (error) dbError(error, 'Create budget');
    return this.withSpending(ctx, data);
  }

  async update(ctx: UserContext, id: string, patch: unknown): Promise<Budget> {
    if (!validId(id)) throw this.notFound();
    const cols = budgetColumns(patch, true);
    const query = Object.keys(cols).length
      ? ctx.db.from(TABLE).update(cols).eq('user_id', ctx.user.id).eq('id', id).select('*')
      : ctx.db.from(TABLE).select('*').eq('user_id', ctx.user.id).eq('id', id);
    const updated = rows(await query, 'Update budget');
    if (!updated[0]) throw this.notFound();
    return this.withSpending(ctx, updated[0]);
  }

  async delete(ctx: UserContext, id: string): Promise<boolean> {
    if (!validId(id)) return false;
    return rows(await ctx.db.from(TABLE).delete().eq('user_id', ctx.user.id).eq('id', id).select('id'), 'Delete budget').length > 0;
  }

  private async withSpending(ctx: UserContext, row: any): Promise<Budget> {
    const period = monthKey(new Date());
    return toBudget(row, ctx.user.id, period, await this.spentIn(ctx, period));
  }

  private notFound() {
    return new NotFoundException({ code: 'not_found', message: 'Budget not found.' });
  }
}
