import { db } from "../db";
import type { AttachedFile } from "@/components/chat-store";

export interface MessageRecord {
  id: string;
  conversation_id: string;
  role: "user" | "ai";
  kind?: string;
  mode?: string;
  status: "thinking" | "done" | "error" | "stopped" | "limit";
  text?: string;
  file_name?: string;
  files: AttachedFile[];
  created_at: string;
}

export interface ConversationRecord {
  id: string;
  title: string;
  project_id?: string;
  created_at: string;
  updated_at: string;
  messages?: MessageRecord[];
}

const CONVERSATIONS = "ledger_conversations";
const MESSAGES = "ledger_messages";

const toConversation = (r: any): ConversationRecord => ({
  id: r.id,
  title: r.title,
  project_id: r.project_id || undefined,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

const toMessage = (m: any): MessageRecord => ({
  id: m.id,
  conversation_id: m.conversation_id,
  role: m.role,
  kind: m.kind || undefined,
  mode: m.mode || undefined,
  status: m.status,
  text: m.text || undefined,
  file_name: m.file_name || undefined,
  files: m.files,
  created_at: m.created_at,
});

export const ChatRepo = {
  async getAllConversations(): Promise<ConversationRecord[]> {
    return (await db.selectAll(CONVERSATIONS, { order: "updated_at.desc,id" })).map(toConversation);
  },

  async getConversation(id: string): Promise<ConversationRecord | null> {
    const c = await db.first(CONVERSATIONS, { id: `eq.${id}` });
    if (!c) return null;
    const messages = await db.selectAll(MESSAGES, { conversation_id: `eq.${id}`, order: "created_at,id" });
    return { ...toConversation(c), messages: messages.map(toMessage) };
  },

  async createConversation(title: string, id?: string, projectId?: string): Promise<ConversationRecord> {
    const row = await db.insert(CONVERSATIONS, { id: id || `c-${Date.now().toString(36)}`, title, project_id: projectId || null });
    return { ...toConversation(row), messages: [] };
  },

  async addMessage(conversationId: string, msg: Omit<MessageRecord, "conversation_id" | "created_at" | "id"> & { id?: string }): Promise<MessageRecord> {
    const exists = await db.first(CONVERSATIONS, { id: `eq.${conversationId}`, select: "id" });
    if (!exists) await this.createConversation(msg.text?.slice(0, 48) || "New chat", conversationId);

    const row = await db.insert(MESSAGES, {
      id: msg.id || `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      conversation_id: conversationId,
      role: msg.role,
      kind: msg.kind || null,
      mode: msg.mode || "Balanced",
      status: msg.status || "done",
      text: msg.text || null,
      file_name: msg.file_name || null,
      files: msg.files || [],
    });
    await db.update(CONVERSATIONS, { id: `eq.${conversationId}` }, { updated_at: row.created_at });
    return toMessage(row);
  },

  /** Removes the AI replies after the last user message, so that message can be answered again. */
  async dropTrailingAiMessages(conversationId: string) {
    const messages = (await this.getConversation(conversationId))?.messages ?? [];
    for (const m of messages.reverse()) {
      if (m.role !== "ai") break;
      await db.remove(MESSAGES, { id: `eq.${m.id}` });
    }
  },

  async updateMessage(id: string, patch: Partial<MessageRecord>) {
    await db.update(MESSAGES, { id: `eq.${id}` }, { status: patch.status, kind: patch.kind, text: patch.text });
  },

  async renameConversation(id: string, title: string) {
    await db.update(CONVERSATIONS, { id: `eq.${id}` }, { title, updated_at: new Date().toISOString() });
  },

  /** Its messages go with it (foreign key cascade). */
  async deleteConversation(id: string): Promise<boolean> {
    return (await db.remove(CONVERSATIONS, { id: `eq.${id}` })) > 0;
  },
};
