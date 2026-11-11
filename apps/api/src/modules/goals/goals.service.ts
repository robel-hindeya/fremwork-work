import { Injectable, NotFoundException } from '@nestjs/common';
import type { Goal, GoalStatus, GoalType } from '@fremwork/types';
import { UserContext, badRequest, dbError, defined, minorFrom, newId, rows, selectAll, text, toMinor, validDate, validId } from '../../common/data/db';

const TABLE = 'ledger_goals';
const TYPES: GoalType[] = ['Savings target', 'Revenue target', 'Expense reduction'];
const STATUSES: GoalStatus[] = ['On track', 'Behind pace', 'Not started'];

function toGoal(r: any, userId: string): Goal {
  return {
    id: r.id,
    workspaceId: userId,
    type: r.type,
    name: r.name,
    startMinor: toMinor(r.start),
    currentMinor: toMinor(r.cur),
    targetMinor: toMinor(r.target),
    targetDate: r.date,
    status: r.status,
    aiGuidance: r.ai || undefined,
    createdAt: r.created_at,
  };
}

function goalColumns(body: unknown, partial: boolean) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) badRequest('Invalid goal.');
  const data = body as Record<string, any>;
  const type = text(data, ['type'], 40) as GoalType | undefined;
  const name = text(data, ['name'], 200)?.trim();
  const target = minorFrom(data, 'targetMinor', ['target']);
  const cur = minorFrom(data, 'currentMinor', ['cur', 'current']);
  const start = minorFrom(data, 'startMinor', ['start']);
  const date = text(data, ['targetDate', 'date'], 10);
  const status = text(data, ['status'], 40) as GoalStatus | undefined;

  if (!partial && !name) badRequest('Enter a goal name.', 'name');
  if (name !== undefined && !name) badRequest('Enter a goal name.', 'name');
  if (!partial && target === undefined) badRequest('Enter a target amount.', 'targetMinor');
  if (!partial && !date) badRequest('Enter a target date.', 'targetDate');
  if (type !== undefined && !TYPES.includes(type)) badRequest(`type must be one of: ${TYPES.join(', ')}.`, 'type');
  if (status !== undefined && !STATUSES.includes(status)) badRequest(`status must be one of: ${STATUSES.join(', ')}.`, 'status');
  if (date !== undefined && !validDate(date)) badRequest('Enter a valid target date (YYYY-MM-DD).', 'targetDate');
  if (data.down !== undefined && typeof data.down !== 'boolean') badRequest('down must be true or false.', 'down');

  return defined({
    type,
    name,
    target: target === undefined ? undefined : target / 100,
    cur: cur === undefined ? undefined : cur / 100,
    start: start === undefined ? undefined : start / 100,
    date,
    status,
    down: data.down as boolean | undefined,
    ai: text(data, ['aiGuidance', 'ai']),
  });
}

@Injectable()
export class GoalsService {
  async findAll(ctx: UserContext): Promise<Goal[]> {
    const list = await selectAll((from, to) => ctx.db.from(TABLE).select('*').eq('user_id', ctx.user.id).order('created_at').order('id').range(from, to), 'List goals');
    return list.map((r) => toGoal(r, ctx.user.id));
  }

  async create(ctx: UserContext, body: unknown): Promise<Goal> {
    const cols = goalColumns(body, false);
    const type = cols.type ?? 'Savings target';
    const cur = cols.cur ?? 0;
    const target = cols.target as number;
    const { data, error } = await ctx.db.from(TABLE).insert({
      id: newId('g'),
      type,
      name: cols.name,
      cur,
      target,
      start: cols.start ?? cur,
      date: cols.date,
      down: cols.down ?? type === 'Expense reduction',
      status: cols.status ?? 'On track',
      ai: cols.ai ?? `Goal established. Tracking pace toward ${type.toLowerCase()} of $${target.toLocaleString('en-US')} by ${cols.date}.`,
    }).select('*').single();
    if (error) dbError(error, 'Create goal');
    return toGoal(data, ctx.user.id);
  }

  async update(ctx: UserContext, id: string, patch: unknown): Promise<Goal> {
    if (!validId(id)) throw this.notFound();
    const cols = goalColumns(patch, true);
    const query = Object.keys(cols).length
      ? ctx.db.from(TABLE).update(cols).eq('user_id', ctx.user.id).eq('id', id).select('*')
      : ctx.db.from(TABLE).select('*').eq('user_id', ctx.user.id).eq('id', id);
    const updated = rows(await query, 'Update goal');
    if (!updated[0]) throw this.notFound();
    return toGoal(updated[0], ctx.user.id);
  }

  async delete(ctx: UserContext, id: string): Promise<boolean> {
    if (!validId(id)) return false;
    return rows(await ctx.db.from(TABLE).delete().eq('user_id', ctx.user.id).eq('id', id).select('id'), 'Delete goal').length > 0;
  }

  private notFound() {
    return new NotFoundException({ code: 'not_found', message: 'Goal not found.' });
  }
}
