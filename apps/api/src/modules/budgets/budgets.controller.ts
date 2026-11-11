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
import { BudgetsService } from './budgets.service';

@ApiTags('Budgets')
@ApiBearerAuth()
@Controller('budgets')
@UseGuards(AuthGuard, WorkspaceGuard)
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Get()
  @ApiOperation({ summary: 'Get category budgets and this month’s actuals in minor units' })
  async getBudgets(@Ctx() ctx: UserContext) {
    return { success: true, data: await this.budgetsService.findAll(ctx) };
  }

  @Post()
  @Roles('owner', 'admin', 'member')
  @ApiOperation({ summary: 'Create monthly category budget' })
  async createBudget(@Ctx() ctx: UserContext, @Body() body: any) {
    return { success: true, data: await this.budgetsService.create(ctx, body) };
  }

  @Put(':id')
  @Roles('owner', 'admin', 'member')
  async replaceBudget(@Ctx() ctx: UserContext, @Param('id') id: string, @Body() patch: any) {
    return { success: true, data: await this.budgetsService.update(ctx, id, patch) };
  }

  @Patch(':id')
  @Roles('owner', 'admin', 'member')
  async updateBudget(@Ctx() ctx: UserContext, @Param('id') id: string, @Body() patch: any) {
    return { success: true, data: await this.budgetsService.update(ctx, id, patch) };
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  async deleteBudget(@Ctx() ctx: UserContext, @Param('id') id: string) {
    if (!(await this.budgetsService.delete(ctx, id))) {
      throw new NotFoundException({ code: 'not_found', message: 'Budget not found.' });
    }
    return { success: true, message: 'Budget deleted.' };
  }
}
