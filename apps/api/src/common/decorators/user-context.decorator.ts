import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { UserContext } from '../data/db';

/** The signed-in caller and their row-level-security-scoped Supabase client (set by AuthGuard). */
export const Ctx = createParamDecorator((_data: unknown, ctx: ExecutionContext): UserContext => {
  return ctx.switchToHttp().getRequest().ctx;
});
