import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SupabaseService } from '../supabase/supabase.service';
import { AgentService } from '../chat/agent.service';

const VERSION = '1.0.0';

@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly agent: AgentService,
  ) {}

  /** Liveness for load balancers (Render's health check): the process is up and serving. */
  @Get(['health', 'api/health'])
  @ApiOperation({ summary: 'Liveness check (no dependencies)' })
  check() {
    return {
      status: 'ok',
      service: 'fremwork-api',
      version: VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /** Readiness: Supabase is reachable and has the ledger schema. 503 otherwise. Reads no user data. */
  @Get(['health/ready', 'api/health/ready'])
  @ApiOperation({ summary: 'Readiness check: Supabase Auth, ledger schema and AI configuration' })
  async ready(@Res() res: Response) {
    const db = await this.supabase.check();
    const ai = this.agent.providers;
    const ok = db.auth === 'ok' && db.schema === 'ok';
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'unavailable',
      service: 'fremwork-api',
      version: VERSION,
      checks: {
        supabaseAuth: db.auth,
        ledgerSchema: db.schema,
        ai: ai.gemini || ai.anthropic ? 'configured' : 'not_configured',
        aiProviders: ai,
      },
      timestamp: new Date().toISOString(),
    });
  }
}
