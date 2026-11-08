import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Authed, CurrentUser, type AuthUser } from './types';

@SkipThrottle()
@Controller('me')
export class MeController {
  @Get()
  @Authed()
  me(@CurrentUser() user: AuthUser) {
    return { ...user, isAdmin: user.role === 'owner' || user.role === 'admin' };
  }
}
