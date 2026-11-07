import { db } from "../db";
import type { Project } from "@/lib/data";

export interface ProjectRecord extends Project {
  created_at?: string;
}

const TABLE = "ledger_projects";

const toRecord = (r: any): ProjectRecord => ({
  id: r.id,
  name: r.name,
  desc: r.description,
  chats: r.chats,
  docs: r.docs,
  reports: r.reports,
  updated: r.updated,
  created_at: r.created_at,
});

export const ProjectsRepo = {
  async getAll(): Promise<ProjectRecord[]> {
    return (await db.selectAll(TABLE, { order: "created_at,id" })).map(toRecord);
  },

  async getById(id: string): Promise<ProjectRecord | null> {
    const r = await db.first(TABLE, { id: `eq.${id}` });
    return r && toRecord(r);
  },

  async create(data: { name: string; desc: string }): Promise<ProjectRecord> {
    const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || `proj-${Date.now()}`;
    const row = await db.insert(TABLE, {
      id: `${slug}-${crypto.randomUUID().slice(0, 6)}`,
      name: data.name,
      description: data.desc,
      updated: "Just now",
    });
    return toRecord(row);
  },

  async update(id: string, patch: Partial<{ name: string; desc: string; chats: string[]; docs: string[]; reports: string[]; updated: string }>): Promise<ProjectRecord | null> {
    const r = await db.update(TABLE, { id: `eq.${id}` }, {
      name: patch.name,
      description: patch.desc,
      chats: patch.chats,
      docs: patch.docs,
      reports: patch.reports,
      updated: patch.updated ?? "Just now",
    });
    return r && toRecord(r);
  },

  async delete(id: string): Promise<boolean> {
    return (await db.remove(TABLE, { id: `eq.${id}` })) > 0;
  },
};
