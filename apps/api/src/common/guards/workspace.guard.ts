import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { UserRole } from '@fremwork/types';

/**
 * Resolves the workspace for a request. Fremwork's ledger is per user (row level security keys every
 * row to auth.uid()), so a user's workspace is their own account. The X-Workspace-Id header is
 * accepted for compatibility but can never select another user's data. Must run after AuthGuard.
 */
@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    if (!request.user?.id) {
      throw new ForbiddenException({ code: 'forbidden', message: 'Sign in to use this workspace.' });
    }
    request.workspaceId = request.user.id;

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const userRole = request.user.role as UserRole;
    if (!requiredRoles.includes(userRole)) {
      throw new ForbiddenException({
        code: 'forbidden',
        message: `Your role (${userRole}) does not have permission to perform this action.`,
      });
    }
    return true;
  }
}
