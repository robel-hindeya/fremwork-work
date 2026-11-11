import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UseGuards,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { Ctx } from '../../common/decorators/user-context.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { UserContext } from '../../common/data/db';
import type { DataSource, DataSourceProvider } from '@fremwork/types';

/**
 * The accounting and banking providers Fremwork plans to support. No provider integration
 * (OAuth, sync) exists yet, so every source reports `disconnected` and connecting or syncing
 * answers 501 rather than pretending to import data. Transactions enter through the ledger API.
 */
const CATALOG: { id: string; provider: DataSourceProvider; name: string; detail: string }[] = [
  { id: 'qb', provider: 'quickbooks', name: 'QuickBooks Online', detail: 'Accounting' },
  { id: 'xero', provider: 'xero', name: 'Xero', detail: 'Accounting' },
  { id: 'bank', provider: 'bank', name: 'Bank feed', detail: 'Bank transactions' },
  { id: 'stripe', provider: 'stripe', name: 'Stripe', detail: 'Payments' },
  { id: 'gusto', provider: 'gusto', name: 'Gusto', detail: 'Payroll' },
];

@ApiTags('Data Sources')
@ApiBearerAuth()
@Controller('data-sources')
@UseGuards(AuthGuard, WorkspaceGuard)
export class DataSourcesController {
  private source(ctx: UserContext, id: string): DataSource {
    const entry = CATALOG.find((s) => s.id === id);
    if (!entry) throw new NotFoundException({ code: 'not_found', message: 'Data source not found.' });
    return {
      ...entry,
      workspaceId: ctx.user.id,
      status: 'disconnected',
      detail: `${entry.detail} · integration not available yet`,
      createdAt: new Date(0).toISOString(),
    };
  }

  private notAvailable(source: DataSource): never {
    throw new NotImplementedException({
      code: 'not_implemented',
      message: `${source.name} integration is not available yet. Add transactions through the ledger (POST /v1/transactions) instead.`,
    });
  }

  @Get()
  @ApiOperation({ summary: 'List accounting and banking connections' })
  getDataSources(@Ctx() ctx: UserContext) {
    return { success: true, data: CATALOG.map((s) => this.source(ctx, s.id)) };
  }

  @Post(':id/sync')
  @Roles('owner', 'admin')
  @ApiOperation({ summary: 'Sync a data source (501 until the integration exists)' })
  syncSourceExplicit(@Ctx() ctx: UserContext, @Param('id') id: string) {
    this.notAvailable(this.source(ctx, id));
  }

  @Post(':id')
  @Roles('owner', 'admin')
  @ApiOperation({ summary: 'Connect or sync a data source (501 until the integration exists)' })
  syncSource(@Ctx() ctx: UserContext, @Param('id') id: string) {
    this.notAvailable(this.source(ctx, id));
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  @ApiOperation({ summary: 'Disconnect a data source' })
  disconnectSource(@Ctx() ctx: UserContext, @Param('id') id: string) {
    const source = this.source(ctx, id);
    return { success: true, message: `${source.name} is not connected.`, data: source };
  }
}
