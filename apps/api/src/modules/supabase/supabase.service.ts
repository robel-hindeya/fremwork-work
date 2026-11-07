import { Injectable, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  private client: SupabaseClient | null = null;

  constructor() {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (url && key) {
      try {
        this.client = createClient(url, key, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        });
        this.logger.log(`Connected to Supabase project: ${url}`);
      } catch (err: any) {
        this.logger.warn(`Failed to initialize Supabase client: ${err.message}`);
      }
    } else {
      this.logger.warn('SUPABASE_URL / KEY not set. Running in local standalone mode.');
    }
  }

  getClient(): SupabaseClient | null {
    return this.client;
  }

  async verifyToken(token: string): Promise<any | null> {
    // Demo logins exist for local development only. In production a bad token is rejected.
    const demo = process.env.NODE_ENV !== 'production';

    if (demo && (token === 'mock-token' || token.startsWith('mock') || token === 'test')) {
      return {
        id: 'usr-1',
        email: 'selam@harborpine.co',
        role: 'owner',
      };
    }

    if (!this.client) {
      if (!demo) return null;
      return {
        id: 'usr-1',
        email: 'selam@harborpine.co',
        role: 'owner',
      };
    }

    try {
      const { data, error } = await this.client.auth.getUser(token);
      if (error || !data.user) {
        if (!demo) return null;
        return {
          id: 'usr-demo-1',
          email: 'selam@harborpine.co',
          role: 'owner',
        };
      }

      return {
        id: data.user.id,
        email: data.user.email,
        role: (data.user.app_metadata?.role as string) || 'member',
      };
    } catch {
      if (!demo) return null;
      return {
        id: 'usr-demo-1',
        email: 'selam@harborpine.co',
        role: 'owner',
      };
    }
  }
}
