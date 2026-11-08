import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type { AuthedRequest, AuthUser } from './types';

/**
 * Verifies the `Authorization: Bearer <supabase access token>` header with Supabase Auth
 * and attaches the user and their profile role to the request.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new UnauthorizedException('Log in to continue.');

    const { data, error } = await this.supabase.db.auth.getUser(token);
    if (error || !data.user) throw new UnauthorizedException('Your session has ended. Log in again.');

    const { data: profile } = await this.supabase.db
      .from('profiles')
      .select('full_name, role')
      .eq('id', data.user.id)
      .maybeSingle();

    const user: AuthUser = {
      id: data.user.id,
      email: data.user.email ?? '',
      name: profile?.full_name ?? (data.user.user_metadata?.full_name as string | undefined) ?? '',
      role: profile?.role ?? 'member',
    };
    req.user = user;
    return true;
  }
}
