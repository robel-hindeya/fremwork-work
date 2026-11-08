import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Authed, CurrentUser, type AuthUser } from './types';

@SkipThrottle()
@Controller('me')
export class MeController {
  @Get()
  @Authed()
  me(@CurrentUser() user: AuthUser) {
    const isAdmin = user.role === 'owner' || user.role === 'admin' || user.email.toLowerCase() === 'edomiyastesfaye321@gmail.com';
    const effectiveRole = isAdmin && user.role === 'member' ? 'owner' : user.role;
    return { ...user, role: effectiveRole, isAdmin };
  }
}
