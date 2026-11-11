import { Injectable, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { loadConfig } from '../../config/env';

export interface AuthUser {
  id: string;
  email: string;
  /** Every user owns their own ledger, so inside it they act as its owner. */
  role: 'owner';
  metadata: Record<string, any>;
}

export class AuthUnavailableError extends Error {}

const CACHE_MS = 30_000;
const CACHE_MAX = 1000;
const TIMEOUT_MS = 10_000;

@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  readonly url: string;
  readonly key: string;
  /** Short cache of verified tokens, keyed by a hash so raw tokens never sit in memory as keys. */
  private readonly verified = new Map<string, { user: AuthUser; expires: number }>();

  constructor() {
    const config = loadConfig();
    this.url = config.supabaseUrl;
    this.key = config.supabaseKey;
    if (this.url && this.key) this.logger.log(`Using Supabase project ${this.url}`);
  }

  get configured(): boolean {
    return Boolean(this.url && this.key);
  }

  /** A client that sends the user's own token, so Postgres row level security applies to every query. */
  forUser(token: string): SupabaseClient {
    return createClient(this.url, this.key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        headers: { Authorization: `Bearer ${token}` },
        fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(TIMEOUT_MS) }),
      },
    });
  }

  /** Calls the Supabase Auth REST API with the project key and, optionally, a user token. */
  authFetch(path: string, init: RequestInit & { token?: string } = {}) {
    const { token, ...rest } = init;
    return fetch(`${this.url}/auth/v1${path}`, {
      ...rest,
      signal: rest.signal ?? AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        apikey: this.key,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(rest.headers as Record<string, string>),
      },
    });
  }

  /**
   * Returns the user for a valid, confirmed access token and null for a missing, forged, expired or
   * unconfirmed one. Supabase checks the signature and revocation. Throws AuthUnavailableError when
   * Supabase can't be reached, so callers can answer 503 instead of 401.
   */
  async verifyToken(token: string): Promise<AuthUser | null> {
    if (!this.configured || typeof token !== 'string' || !token || token.length > 16384) return null;
    const cacheKey = createHash('sha256').update(token).digest('hex');
    const hit = this.verified.get(cacheKey);
    if (hit && hit.expires > Date.now()) return hit.user;

    let response: Response;
    try {
      response = await this.authFetch('/user', { token });
    } catch (err: any) {
      this.logger.error(`Supabase Auth unreachable: ${err.message}`);
      throw new AuthUnavailableError('Authentication service unavailable.');
    }
    if (response.status >= 500) throw new AuthUnavailableError('Authentication service unavailable.');
    if (!response.ok) return null;

    const payload: any = await response.json().catch(() => null);
    if (typeof payload?.id !== 'string' || !payload.email_confirmed_at) return null;
    const user: AuthUser = { id: payload.id, email: String(payload.email ?? ''), role: 'owner', metadata: payload.user_metadata ?? {} };

    if (this.verified.size >= CACHE_MAX) this.verified.delete(this.verified.keys().next().value as string);
    this.verified.set(cacheKey, { user, expires: Date.now() + CACHE_MS });
    return user;
  }

  /** Forgets a cached token, e.g. after the user's metadata changes. */
  forget(token: string) {
    this.verified.delete(createHash('sha256').update(token).digest('hex'));
  }

  /** Readiness: is Supabase reachable, and does it have the Fremwork ledger schema? */
  async check(): Promise<{ auth: 'ok' | 'unreachable' | 'not_configured'; schema: 'ok' | 'missing' | 'unknown' }> {
    if (!this.configured) return { auth: 'not_configured', schema: 'unknown' };
    let auth: 'ok' | 'unreachable' = 'unreachable';
    let schema: 'ok' | 'missing' | 'unknown' = 'unknown';
    try {
      const res = await this.authFetch('/health', { signal: AbortSignal.timeout(4000) });
      if (res.ok) auth = 'ok';
    } catch {
      /* unreachable */
    }
    try {
      // Anonymous callers have no grants on the ledger, so an existing table answers 401/403 (permission
      // denied), while a missing one answers 404 PGRST205. Neither reads any data.
      const res = await fetch(`${this.url}/rest/v1/ledger_transactions?select=id&limit=0`, {
        headers: { apikey: this.key },
        signal: AbortSignal.timeout(4000),
      });
      const body: any = await res.json().catch(() => ({}));
      if (res.status === 404 || body?.code === 'PGRST205' || body?.code === '42P01') schema = 'missing';
      else if (res.ok || res.status === 401 || res.status === 403 || body?.code === '42501') schema = 'ok';
    } catch {
      /* unknown */
    }
    return { auth, schema };
  }
}
