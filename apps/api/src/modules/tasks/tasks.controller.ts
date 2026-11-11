import {
  Controller,
  Get,
  Post,
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
import { TasksService } from './tasks.service';

@ApiTags('Scheduled Tasks')
@ApiBearerAuth()
@Controller(['tasks', 'scheduled'])
@UseGuards(AuthGuard, WorkspaceGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @ApiOperation({ summary: 'List saved prompt tasks' })
  async getTasks(@Ctx() ctx: UserContext) {
    return { success: true, data: await this.tasks.findAll(ctx) };
  }

  @Post()
  @Roles('owner', 'admin', 'member')
  @ApiOperation({ summary: 'Create a saved prompt task' })
  async createTask(@Ctx() ctx: UserContext, @Body() body: any) {
    return { success: true, data: await this.tasks.create(ctx, body) };
  }

  @Post(':id/run')
  @Roles('owner', 'admin', 'member')
  @ApiOperation({ summary: 'Run a task now; the answer is saved as a new conversation' })
  runTaskExplicit(@Ctx() ctx: UserContext, @Param('id') id: string) {
    return this.tasks.run(ctx, id);
  }

  @Post(':id')
  @Roles('owner', 'admin', 'member')
  @ApiOperation({ summary: 'Run a task now (alias of POST /:id/run)' })
  runTask(@Ctx() ctx: UserContext, @Param('id') id: string) {
    return this.tasks.run(ctx, id);
  }

  @Patch(':id')
  @Roles('owner', 'admin')
  async updateTask(@Ctx() ctx: UserContext, @Param('id') id: string, @Body() patch: any) {
    return { success: true, data: await this.tasks.update(ctx, id, patch) };
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  async deleteTask(@Ctx() ctx: UserContext, @Param('id') id: string) {
    if (!(await this.tasks.delete(ctx, id))) {
      throw new NotFoundException({ code: 'not_found', message: 'Task not found.' });
    }
    return { success: true, message: 'Task deleted.' };
  }
}
