import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { Ctx } from '../../common/decorators/user-context.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { UserContext } from '../../common/data/db';
import { LedgerService } from './ledger.service';

@ApiTags('Unified Ledger')
@ApiBearerAuth()
@Controller('transactions')
@UseGuards(AuthGuard, WorkspaceGuard)
export class LedgerController {
  constructor(private readonly ledgerService: LedgerService) {}

  @Get()
  @ApiOperation({ summary: 'Get filtered transactions list and totals in minor units' })
  async getTransactions(
    @Ctx() ctx: UserContext,
    @Query('type') type?: 'all' | 'income' | 'expense',
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('category') category?: string,
    @Query('limit') limit?: string,
  ) {
    const { rows, totals } = await this.ledgerService.findAll(ctx, { type, q, from, to, category, limit: Number(limit) || 50 });
    return { success: true, data: rows, totals };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one transaction' })
  async getTransaction(@Ctx() ctx: UserContext, @Param('id') id: string) {
    return { success: true, data: await this.ledgerService.findOne(ctx, id) };
  }

  @Post()
  @Roles('owner', 'admin', 'member')
  @ApiOperation({ summary: 'Record manual transaction into the ledger' })
  async addTransaction(@Ctx() ctx: UserContext, @Body() body: any) {
    return { success: true, data: await this.ledgerService.create(ctx, body) };
  }

  @Put(':id')
  @Roles('owner', 'admin', 'member', 'accountant')
  @ApiOperation({ summary: 'Update category, note, or review status' })
  async replaceTransaction(@Ctx() ctx: UserContext, @Param('id') id: string, @Body() patch: any) {
    return { success: true, data: await this.ledgerService.update(ctx, id, patch) };
  }

  @Patch(':id')
  @Roles('owner', 'admin', 'member', 'accountant')
  @ApiOperation({ summary: 'Update category, note, or review status' })
  async updateTransaction(@Ctx() ctx: UserContext, @Param('id') id: string, @Body() patch: any) {
    return { success: true, data: await this.ledgerService.update(ctx, id, patch) };
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  @ApiOperation({ summary: 'Delete transaction from the ledger' })
  async deleteTransaction(@Ctx() ctx: UserContext, @Param('id') id: string) {
    if (!(await this.ledgerService.delete(ctx, id))) {
      throw new NotFoundException({ code: 'not_found', message: 'Transaction not found.' });
    }
    return { success: true, message: 'Transaction deleted.' };
  }
}
