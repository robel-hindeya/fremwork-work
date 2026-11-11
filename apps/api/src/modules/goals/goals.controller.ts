import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { Ctx } from '../../common/decorators/user-context.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { UserContext } from '../../common/data/db';
import { GoalsService } from './goals.service';

@ApiTags('Goals')
@ApiBearerAuth()
@Controller('goals')
@UseGuards(AuthGuard, WorkspaceGuard)
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Get()
  @ApiOperation({ summary: 'Get financial targets and tracking guidance' })
  async getGoals(@Ctx() ctx: UserContext) {
    return { success: true, data: await this.goals.findAll(ctx) };
  }

  @Post()
  @Roles('owner', 'admin', 'member')
  @ApiOperation({ summary: 'Create new savings or revenue goal' })
  async createGoal(@Ctx() ctx: UserContext, @Body() body: any) {
    return { success: true, data: await this.goals.create(ctx, body) };
  }

  @Put(':id')
  @Roles('owner', 'admin', 'member')
  async replaceGoal(@Ctx() ctx: UserContext, @Param('id') id: string, @Body() patch: any) {
    return { success: true, data: await this.goals.update(ctx, id, patch) };
  }

  @Patch(':id')
  @Roles('owner', 'admin', 'member')
  async updateGoal(@Ctx() ctx: UserContext, @Param('id') id: string, @Body() patch: any) {
    return { success: true, data: await this.goals.update(ctx, id, patch) };
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  async deleteGoal(@Ctx() ctx: UserContext, @Param('id') id: string) {
    if (!(await this.goals.delete(ctx, id))) {
      throw new NotFoundException({ code: 'not_found', message: 'Goal not found.' });
    }
    return { success: true, message: 'Goal deleted.' };
  }
}
