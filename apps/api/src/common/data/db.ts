import { BadRequestException, ConflictException, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthUser } from '../../modules/supabase/supabase.service';

/** The signed-in caller: who they are, and a Supabase client that queries as them. */
export interface UserContext {
  user: AuthUser;
  token: string;
  db: SupabaseClient;
}

const logger = new Logger('Database');

/** PostgREST never returns more than this many rows per request. */
export const PAGE = 1000;

/** Turns a PostgREST error into an API error without leaking SQL details to the client. */
export function dbError(error: { code?: string; message?: string } | null | undefined, action: string): never {
  if (error?.code === '23505') throw new ConflictException({ code: 'conflict', message: 'A record with that name or id already exists.' });
  if (error?.code === '22P02' || error?.code === '23502' || error?.code === '22003') {
    throw new BadRequestException({ code: 'validation_failed', message: 'One of the values is not valid.' });
  }
  logger.error(`${action} failed: ${error?.code ?? ''} ${error?.message ?? 'unknown error'}`);
  throw new ServiceUnavailableException({ code: 'unavailable', message: 'Your financial data is temporarily unavailable. Please try again.' });
}

/** Unwraps a Supabase response, throwing an API error if it failed. */
export function rows<T = any>(result: { data: T[] | null; error: any }, action: string): T[] {
  if (result.error) dbError(result.error, action);
  return result.data ?? [];
}

/** Reads every page of a query. `build` must return a query with a stable order. */
export async function selectAll<T = any>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>, action: string): Promise<T[]> {
  const all: T[] = [];
  for (;;) {
    const page = rows(await build(all.length, all.length + PAGE - 1), action);
    all.push(...page);
    if (page.length < PAGE) return all;
  }
}

/** Dollars (numeric(16,2) in Postgres) to integer cents. */
export const toMinor = (dollars: unknown) => Math.round(Number(dollars) * 100);

/** Integer cents to dollars with two decimals. */
export const fromMinor = (minor: number) => Math.round(minor) / 100;

export const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** A date-sortable id with a random suffix, e.g. `b-lx2k9a-4f1c`. */
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** Quotes a value for use inside a PostgREST `or=(...)` filter. */
export const quoted = (value: string) => `"${value.replace(/[\\"]/g, '\\$&')}"`;

/** Escapes LIKE wildcards so user input matches literally. */
export const literalLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

/** Ids are text keys chosen by clients for some tables; keep them short and URL-safe. */
export function validId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(id);
}

export function badRequest(message: string, field?: string): never {
  throw new BadRequestException({ code: 'validation_failed', message, ...(field ? { field } : {}) });
}

/** Reads a money value given either in cents (`*Minor`) or dollars, returning cents. */
export function minorFrom(body: Record<string, any>, minorKey: string, dollarKeys: string[]): number | undefined {
  if (body[minorKey] !== undefined) {
    const v = body[minorKey];
    if (typeof v !== 'number' || !Number.isInteger(v) || Math.abs(v) > 1e14) badRequest(`${minorKey} must be an integer number of cents.`, minorKey);
    return v;
  }
  for (const key of dollarKeys) {
    if (body[key] === undefined) continue;
    const v = body[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e12 || Math.abs(v * 100 - Math.round(v * 100)) > 0.001) {
      badRequest(`${key} must be a number with at most two decimal places.`, key);
    }
    return Math.round(v * 100);
  }
  return undefined;
}

/** Reads an optional string field, enforcing a maximum length. */
export function text(body: Record<string, any>, keys: string[], max = 2000): string | undefined {
  for (const key of keys) {
    const v = body[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string' || v.length > max) badRequest(`${key} must be text of at most ${max} characters.`, key);
    return v;
  }
  return undefined;
}

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Drops undefined values so a PATCH only touches the fields that were sent. */
export const defined = <T extends Record<string, unknown>>(obj: T) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
