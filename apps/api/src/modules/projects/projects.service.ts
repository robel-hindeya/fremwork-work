import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Project } from '@fremwork/types';
import { UserContext, badRequest, dbError, defined, rows, selectAll, text, validId } from '../../common/data/db';

const TABLE = 'ledger_projects';

const list = (v: unknown) => (Array.isArray(v) ? v : []);

function toProject(r: any, userId: string): Project {
  return {
    id: r.id,
    workspaceId: userId,
    name: r.name,
    description: r.description,
    chatsCount: list(r.chats).length,
    filesCount: list(r.docs).length,
    reportsCount: list(r.reports).length,
    updatedAt: r.updated,
    createdAt: r.created_at,
  };
}

function stringList(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 500 || value.some((v) => typeof v !== 'string' || v.length > 200)) {
    badRequest(`${field} must be a list of short strings.`, field);
  }
  return value as string[];
}

@Injectable()
export class ProjectsService {
  async findAll(ctx: UserContext): Promise<Project[]> {
    const all = await selectAll((from, to) => ctx.db.from(TABLE).select('*').eq('user_id', ctx.user.id).order('created_at').order('id').range(from, to), 'List projects');
    return all.map((r) => toProject(r, ctx.user.id));
  }

  async findOne(ctx: UserContext, id: string): Promise<Project> {
    if (!validId(id)) throw this.notFound();
    const found = rows(await ctx.db.from(TABLE).select('*').eq('user_id', ctx.user.id).eq('id', id).limit(1), 'Read project');
    if (!found[0]) throw this.notFound();
    return toProject(found[0], ctx.user.id);
  }

  async create(ctx: UserContext, body: any): Promise<Project> {
    const name = text(body ?? {}, ['name'], 200)?.trim();
    if (!name) badRequest('Enter a project name.', 'name');
    const description = text(body, ['description', 'desc']) ?? '';
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60) || 'project';
    const { data, error } = await ctx.db.from(TABLE).insert({
      id: `${slug}-${randomUUID().slice(0, 6)}`,
      name,
      description,
      updated: 'Just now',
    }).select('*').single();
    if (error) dbError(error, 'Create project');
    return toProject(data, ctx.user.id);
  }

  async update(ctx: UserContext, id: string, body: any): Promise<Project> {
    if (!validId(id)) throw this.notFound();
    if (!body || typeof body !== 'object' || Array.isArray(body)) badRequest('Invalid project.');
    const name = text(body, ['name'], 200)?.trim();
    if (name !== undefined && !name) badRequest('Enter a project name.', 'name');
    const cols = defined({
      name,
      description: text(body, ['description', 'desc']),
      chats: stringList(body.chats, 'chats'),
      docs: stringList(body.docs, 'docs'),
      reports: stringList(body.reports, 'reports'),
      updated: 'Just now',
    });
    const updated = rows(await ctx.db.from(TABLE).update(cols).eq('user_id', ctx.user.id).eq('id', id).select('*'), 'Update project');
    if (!updated[0]) throw this.notFound();
    return toProject(updated[0], ctx.user.id);
  }

  async delete(ctx: UserContext, id: string): Promise<boolean> {
    if (!validId(id)) return false;
    return rows(await ctx.db.from(TABLE).delete().eq('user_id', ctx.user.id).eq('id', id).select('id'), 'Delete project').length > 0;
  }

  private notFound() {
    return new NotFoundException({ code: 'not_found', message: 'Project not found.' });
  }
}
