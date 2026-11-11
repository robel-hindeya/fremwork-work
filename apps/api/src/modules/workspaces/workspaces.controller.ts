import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  HttpCode,
  UseGuards,
  NotFoundException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Workspace } from '@fremwork/types';
import { AuthGuard } from '../../common/guards/auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { Ctx } from '../../common/decorators/user-context.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserContext, badRequest, text } from '../../common/data/db';
import { SupabaseService } from '../supabase/supabase.service';

type Settings = Omit<Workspace, 'id' | 'createdAt' | 'updatedAt'> & { updatedAt?: string };

const DEFAULTS: Settings = {
  legalName: '',
  industry: undefined,
  country: '',
  currency: 'USD',
  fiscalYearStart: 1,
  accountingBasis: 'accrual',
  reserveMonths: 3,
  tin: undefined,
};

/** Validates workspace settings from a request body; unknown keys are ignored. */
export function settingsPatch(body: unknown): Partial<Settings> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) badRequest('Invalid workspace settings.');
  const b = body as Record<string, any>;
  const patch: Partial<Settings> = {};
  const legalName = text(b, ['legalName'], 200);
  if (legalName !== undefined) patch.legalName = legalName.trim();
  const industry = text(b, ['industry'], 100);
  if (industry !== undefined) patch.industry = industry;
  const country = text(b, ['country'], 2);
  if (country !== undefined) {
    if (!/^[A-Z]{2}$/.test(country)) badRequest('country must be a two-letter ISO code such as ET or KE.', 'country');
    patch.country = country;
  }
  const currency = text(b, ['currency'], 3);
  if (currency !== undefined) {
    if (!/^[A-Z]{3}$/.test(currency)) badRequest('currency must be a three-letter ISO code such as USD.', 'currency');
    patch.currency = currency;
  }
  if (b.fiscalYearStart !== undefined) {
    if (!Number.isInteger(b.fiscalYearStart) || b.fiscalYearStart < 1 || b.fiscalYearStart > 12) badRequest('fiscalYearStart must be a month from 1 to 12.', 'fiscalYearStart');
    patch.fiscalYearStart = b.fiscalYearStart;
  }
  if (b.accountingBasis !== undefined) {
    if (!['accrual', 'cash'].includes(b.accountingBasis)) badRequest('accountingBasis must be accrual or cash.', 'accountingBasis');
    patch.accountingBasis = b.accountingBasis;
  }
  if (b.reserveMonths !== undefined) {
    if (typeof b.reserveMonths !== 'number' || !(b.reserveMonths >= 0 && b.reserveMonths <= 60)) badRequest('reserveMonths must be between 0 and 60.', 'reserveMonths');
    patch.reserveMonths = b.reserveMonths;
  }
  const tin = text(b, ['tin'], 50);
  if (tin !== undefined) patch.tin = tin;
  return patch;
}

/**
 * Each user's workspace is their own account (the ledger is per user). Its company settings live
 * in the user's Supabase `user_metadata.workspace`, which only that user can change.
 */
@ApiTags('Workspaces')
@ApiBearerAuth()
@Controller('workspaces')
@UseGuards(AuthGuard)
export class WorkspacesController {
  private readonly logger = new Logger(WorkspacesController.name);

  constructor(private readonly supabase: SupabaseService) {}

  private view(ctx: UserContext): Workspace {
    const meta = ctx.user.metadata ?? {};
    const saved = meta.workspace && typeof meta.workspace === 'object' ? meta.workspace : {};
    const s: Settings = { ...DEFAULTS, legalName: meta.company || '', ...saved };
    return {
      id: ctx.user.id,
      legalName: s.legalName,
      industry: s.industry,
      country: s.country,
      currency: s.currency,
      fiscalYearStart: s.fiscalYearStart,
      accountingBasis: s.accountingBasis,
      reserveMonths: s.reserveMonths,
      tin: s.tin,
      createdAt: meta.workspace_created_at || new Date(0).toISOString(),
      updatedAt: s.updatedAt || meta.workspace_created_at || new Date(0).toISOString(),
    };
  }

  /** `me` and `current` are aliases for the caller's own workspace id. */
  private own(ctx: UserContext, id: string) {
    if (id !== ctx.user.id && id !== 'me' && id !== 'current') {
      throw new NotFoundException({ code: 'not_found', message: 'Workspace not found.' });
    }
  }

  private async save(ctx: UserContext, patch: Partial<Settings>, created = false): Promise<Workspace> {
    const now = new Date().toISOString();
    const current = this.view(ctx);
    const { id: _id, createdAt: _c, ...settings } = current;
    const data: Record<string, unknown> = { workspace: { ...settings, ...patch, updatedAt: now } };
    if (created && !ctx.user.metadata?.workspace_created_at) data.workspace_created_at = now;

    const res = await this.supabase.authFetch('/user', { method: 'PUT', token: ctx.token, body: JSON.stringify({ data }) }).catch(() => null);
    if (!res?.ok) {
      this.logger.error(`Saving workspace settings failed: HTTP ${res?.status ?? 'network error'}`);
      throw new ServiceUnavailableException({ code: 'unavailable', message: 'Workspace settings could not be saved. Please try again.' });
    }
    const user: any = await res.json();
    this.supabase.forget(ctx.token);
    return this.view({ ...ctx, user: { ...ctx.user, metadata: user.user_metadata ?? {} } });
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Set up the caller’s company workspace during onboarding' })
  async createWorkspace(@Ctx() ctx: UserContext, @Body() body: any) {
    return { success: true, data: await this.save(ctx, settingsPatch(body), true) };
  }

  @Get(':id')
  @UseGuards(WorkspaceGuard)
  @ApiOperation({ summary: 'Get company workspace info and financial policies' })
  getWorkspace(@Ctx() ctx: UserContext, @Param('id') id: string) {
    this.own(ctx, id);
    return { success: true, data: this.view(ctx) };
  }

  @Patch(':id')
  @UseGuards(WorkspaceGuard)
  @Roles('owner', 'admin')
  @ApiOperation({ summary: 'Update company settings or reserve policies' })
  async updateWorkspace(@Ctx() ctx: UserContext, @Param('id') id: string, @Body() patch: any) {
    this.own(ctx, id);
    return { success: true, data: await this.save(ctx, settingsPatch(patch)) };
  }
}
