import { Injectable, NotFoundException } from '@nestjs/common';
import type { ScheduledTask } from '@fremwork/types';
import { UserContext, badRequest, dbError, defined, newId, rows, selectAll, text, validId } from '../../common/data/db';
import { AgentError, AgentService } from '../chat/agent.service';
import { ConversationsService } from '../chat/conversations.service';
import { blocksToMarkdown } from '../chat/blocks';

const TABLE = 'ledger_tasks';
const NEVER_RUN = 'Not run yet';

function toTask(r: any, userId: string): ScheduledTask {
  const ran = r.last_run && r.last_run !== NEVER_RUN;
  return {
    id: r.id,
    workspaceId: userId,
    name: r.name,
    prompt: r.prompt,
    cron: r.freq,
    timezone: 'UTC',
    deliverTo: 'chat',
    enabled: Boolean(r.is_on),
    nextRunAt: r.next_run,
    lastRunStatus: r.last_failed ? 'failed' : ran ? 'completed' : undefined,
    lastRunError: r.last_failed ? r.last_run : undefined,
    createdAt: r.created_at,
  };
}

function taskColumns(body: unknown, partial: boolean) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) badRequest('Invalid task.');
  const data = body as Record<string, any>;
  const name = text(data, ['name'], 200)?.trim();
  const prompt = text(data, ['prompt'], 4000)?.trim();
  const enabled = data.enabled ?? data.on;
  if (!partial && !name) badRequest('Enter a task name.', 'name');
  if (!partial && !prompt) badRequest('Enter the prompt to run.', 'prompt');
  if (name !== undefined && !name) badRequest('Enter a task name.', 'name');
  if (prompt !== undefined && !prompt) badRequest('Enter the prompt to run.', 'prompt');
  if (enabled !== undefined && typeof enabled !== 'boolean') badRequest('enabled must be true or false.', 'enabled');
  return defined({
    name,
    prompt,
    freq: text(data, ['cron', 'freq'], 100),
    next_run: text(data, ['nextRunAt', 'next'], 100),
    is_on: enabled as boolean | undefined,
  });
}

@Injectable()
export class TasksService {
  constructor(
    private readonly agent: AgentService,
    private readonly conversations: ConversationsService,
  ) {}

  async findAll(ctx: UserContext): Promise<ScheduledTask[]> {
    const all = await selectAll((from, to) => ctx.db.from(TABLE).select('*').eq('user_id', ctx.user.id).order('created_at').order('id').range(from, to), 'List tasks');
    return all.map((r) => toTask(r, ctx.user.id));
  }

  async create(ctx: UserContext, body: unknown): Promise<ScheduledTask> {
    const cols = taskColumns(body, false);
    const { data, error } = await ctx.db.from(TABLE).insert({
      id: newId('t'),
      name: cols.name,
      prompt: cols.prompt,
      freq: cols.freq || 'Manual',
      next_run: cols.next_run || 'Run manually',
      last_run: NEVER_RUN,
      is_on: cols.is_on ?? true,
    }).select('*').single();
    if (error) dbError(error, 'Create task');
    return toTask(data, ctx.user.id);
  }

  async update(ctx: UserContext, id: string, patch: unknown): Promise<ScheduledTask> {
    if (!validId(id)) throw this.notFound();
    const cols = taskColumns(patch, true);
    const query = Object.keys(cols).length
      ? ctx.db.from(TABLE).update(cols).eq('user_id', ctx.user.id).eq('id', id).select('*')
      : ctx.db.from(TABLE).select('*').eq('user_id', ctx.user.id).eq('id', id);
    const updated = rows(await query, 'Update task');
    if (!updated[0]) throw this.notFound();
    return toTask(updated[0], ctx.user.id);
  }

  async delete(ctx: UserContext, id: string): Promise<boolean> {
    if (!validId(id)) return false;
    return rows(await ctx.db.from(TABLE).delete().eq('user_id', ctx.user.id).eq('id', id).select('id'), 'Delete task').length > 0;
  }

  /** Runs a task now: sends its prompt to the AI and saves the answer as a new chat. */
  async run(ctx: UserContext, id: string) {
    if (!validId(id)) throw this.notFound();
    const found = rows(await ctx.db.from(TABLE).select('*').eq('user_id', ctx.user.id).eq('id', id).limit(1), 'Read task');
    const task = found[0];
    if (!task) throw this.notFound();

    const stamp = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
    try {
      await this.agent.checkQuota(ctx);
      const result = await this.agent.run(ctx, [{ role: 'user', text: task.prompt }]);
      const convo = await this.conversations.create(ctx, `${task.name} · ${stamp}`);
      await this.conversations.addMessage(ctx, convo.id, { role: 'user', text: task.prompt });
      await this.conversations.addMessage(ctx, convo.id, { role: 'ai', text: blocksToMarkdown(result.blocks) });
      await ctx.db.from(TABLE).update({ last_run: `${stamp} · Completed`, last_failed: false }).eq('user_id', ctx.user.id).eq('id', id);
      const data = await this.update(ctx, id, {});
      return { success: true, message: `Task "${task.name}" finished. The result is in your chats.`, conversationId: convo.id, task: data, data };
    } catch (err: any) {
      const reason = err instanceof AgentError ? err.message : 'The task could not run. Please try again.';
      await ctx.db.from(TABLE).update({ last_run: `${stamp} · Failed: ${reason}`.slice(0, 300), last_failed: true }).eq('user_id', ctx.user.id).eq('id', id);
      const data = await this.update(ctx, id, {});
      return { success: false, message: reason, task: data, data };
    }
  }

  private notFound() {
    return new NotFoundException({ code: 'not_found', message: 'Task not found.' });
  }
}
