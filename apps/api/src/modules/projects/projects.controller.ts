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
import { ProjectsService } from './projects.service';

@ApiTags('Projects')
@ApiBearerAuth()
@Controller('projects')
@UseGuards(AuthGuard, WorkspaceGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @ApiOperation({ summary: 'List workspace projects' })
  async getProjects(@Ctx() ctx: UserContext) {
    return { success: true, data: await this.projects.findAll(ctx) };
  }

  @Post()
  @Roles('owner', 'admin', 'member')
  @ApiOperation({ summary: 'Create new project workspace' })
  async createProject(@Ctx() ctx: UserContext, @Body() body: any) {
    return { success: true, data: await this.projects.create(ctx, body) };
  }

  @Get(':id')
  async getProject(@Ctx() ctx: UserContext, @Param('id') id: string) {
    return { success: true, data: await this.projects.findOne(ctx, id) };
  }

  @Put(':id')
  @Roles('owner', 'admin', 'member')
  async replaceProject(@Ctx() ctx: UserContext, @Param('id') id: string, @Body() patch: any) {
    return { success: true, data: await this.projects.update(ctx, id, patch) };
  }

  @Patch(':id')
  @Roles('owner', 'admin', 'member')
  async updateProject(@Ctx() ctx: UserContext, @Param('id') id: string, @Body() patch: any) {
    return { success: true, data: await this.projects.update(ctx, id, patch) };
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  async deleteProject(@Ctx() ctx: UserContext, @Param('id') id: string) {
    if (!(await this.projects.delete(ctx, id))) {
      throw new NotFoundException({ code: 'not_found', message: 'Project not found.' });
    }
    return { success: true, message: 'Project deleted.' };
  }
}
