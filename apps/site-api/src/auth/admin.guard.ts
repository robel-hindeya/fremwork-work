import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthedRequest } from './types';

/** Use after SupabaseAuthGuard. Lets owners and admins through. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const { user } = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (user && (user.role === 'owner' || user.role === 'admin')) return true;
    throw new ForbiddenException('You need admin access for this.');
  }
}
