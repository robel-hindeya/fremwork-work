import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthUnavailableError, SupabaseService } from '../../modules/supabase/supabase.service';
import type { UserContext } from '../data/db';

/**
 * Requires `Authorization: Bearer <Supabase access token>`. The token is verified with Supabase Auth,
 * then `request.ctx` carries a Supabase client that queries as that user, so row level security
 * decides which rows they can read or write.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header = request.headers['authorization'];
    const token = typeof header === 'string' && /^Bearer\s+\S+$/i.test(header) ? header.replace(/^Bearer\s+/i, '') : '';
    if (!token) {
      throw new UnauthorizedException({ code: 'unauthenticated', message: 'Missing or invalid Authorization header.' });
    }

    let user;
    try {
      user = await this.supabase.verifyToken(token);
    } catch (err) {
      if (err instanceof AuthUnavailableError) {
        throw new ServiceUnavailableException({ code: 'unavailable', message: 'Sign-in could not be checked right now. Please try again.' });
      }
      throw err;
    }
    if (!user) {
      throw new UnauthorizedException({ code: 'unauthenticated', message: 'Session expired or token invalid.' });
    }

    const ctx: UserContext = { user, token, db: this.supabase.forUser(token) };
    request.user = user;
    request.ctx = ctx;
    return true;
  }
}
