import { Injectable, NotFoundException } from '@nestjs/common';
import type { Conversation, Message, MessageStatus, ReasoningMode } from '@fremwork/types';
import { UserContext, dbError, newId, rows, selectAll, validId } from '../../common/data/db';

const CONVERSATIONS = 'ledger_conversations';
const MESSAGES = 'ledger_messages';

/** Message rows are shared with the web workspace, which stores roles as user/ai and plain text. */
type StoredStatus = 'thinking' | 'done' | 'error' | 'stopped' | 'limit';

const STATUS: Record<StoredStatus, MessageStatus> = { thinking: 'streaming', done: 'done', error: 'error', stopped: 'stopped', limit: 'error' };

export interface HistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

function toConversation(r: any, userId: string): Conversation {
  return {
    id: r.id,
    workspaceId: userId,
    title: r.title,
    projectId: r.project_id || undefined,
    createdBy: userId,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toMessage(m: any): Message {
  return {
    id: m.id,
    conversationId: m.conversation_id,
    role: m.role === 'user' ? 'user' : 'assistant',
    blocks: m.text ? [{ type: 'text', text: m.text }] : [],
    mode: (m.mode || 'Balanced') as ReasoningMode,
    status: STATUS[m.status as StoredStatus] ?? 'done',
    createdAt: m.created_at,
  };
}

@Injectable()
export class ConversationsService {
  async list(ctx: UserContext): Promise<Conversation[]> {
    const all = await selectAll((from, to) => ctx.db.from(CONVERSATIONS).select('*').eq('user_id', ctx.user.id).order('updated_at', { ascending: false }).order('id').range(from, to), 'List conversations');
    return all.map((r) => toConversation(r, ctx.user.id));
  }

  async find(ctx: UserContext, id: string): Promise<Conversation | null> {
    if (!validId(id)) return null;
    const found = rows(await ctx.db.from(CONVERSATIONS).select('*').eq('user_id', ctx.user.id).eq('id', id).limit(1), 'Read conversation');
    return found[0] ? toConversation(found[0], ctx.user.id) : null;
  }

  async get(ctx: UserContext, id: string): Promise<Conversation> {
    const convo = await this.find(ctx, id);
    if (!convo) throw new NotFoundException({ code: 'not_found', message: 'Conversation not found.' });
    const messages = await selectAll((from, to) => ctx.db.from(MESSAGES).select('*').eq('user_id', ctx.user.id).eq('conversation_id', id).order('created_at').order('id').range(from, to), 'Read messages');
    return { ...convo, messages: messages.map(toMessage) };
  }

  /** The last `limit` finished turns, oldest first, as plain text for the AI's context. */
  async history(ctx: UserContext, id: string, limit = 20): Promise<HistoryTurn[]> {
    const recent = rows(
      await ctx.db.from(MESSAGES).select('role,text,status,created_at').eq('user_id', ctx.user.id).eq('conversation_id', id)
        .eq('status', 'done').not('text', 'is', null).order('created_at', { ascending: false }).limit(limit),
      'Read history',
    );
    return recent.reverse().map((m: any) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: String(m.text) }));
  }

  async create(ctx: UserContext, title: string, opts: { id?: string; projectId?: string } = {}): Promise<Conversation> {
    const { data, error } = await ctx.db.from(CONVERSATIONS).insert({
      id: opts.id || newId('c'),
      title: title.slice(0, 200) || 'New conversation',
      project_id: opts.projectId || null,
    }).select('*').single();
    if (error) dbError(error, 'Create conversation');
    return { ...toConversation(data, ctx.user.id), messages: [] };
  }

  async addMessage(ctx: UserContext, conversationId: string, msg: { role: 'user' | 'ai'; text: string; mode?: string; status?: StoredStatus }) {
    const { data, error } = await ctx.db.from(MESSAGES).insert({
      id: newId('m'),
      conversation_id: conversationId,
      role: msg.role,
      mode: msg.mode || 'Balanced',
      status: msg.status || 'done',
      text: msg.text,
      files: [],
    }).select('created_at').single();
    if (error) dbError(error, 'Save message');
    await ctx.db.from(CONVERSATIONS).update({ updated_at: data.created_at }).eq('user_id', ctx.user.id).eq('id', conversationId);
  }

  async rename(ctx: UserContext, id: string, title: string) {
    const { error } = await ctx.db.from(CONVERSATIONS).update({ title: title.slice(0, 200) }).eq('user_id', ctx.user.id).eq('id', id);
    if (error) dbError(error, 'Rename conversation');
  }

  /** Its messages go with it (foreign key cascade). */
  async delete(ctx: UserContext, id: string): Promise<boolean> {
    if (!validId(id)) return false;
    return rows(await ctx.db.from(CONVERSATIONS).delete().eq('user_id', ctx.user.id).eq('id', id).select('id'), 'Delete conversation').length > 0;
  }
}
