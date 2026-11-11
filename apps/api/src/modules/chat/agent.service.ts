import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type { AnswerBlock, ReasoningMode } from '@fremwork/types';
import { UserContext, fromMinor } from '../../common/data/db';
import { loadConfig, type ApiConfig } from '../../config/env';
import { LedgerService } from '../ledger/ledger.service';
import { FinancialService } from '../ledger/financial.service';
import { BudgetsService } from '../budgets/budgets.service';
import { calculate } from './calculate';
import { parseAnswer } from './blocks';
import type { HistoryTurn } from './conversations.service';

/** An error whose message is safe to show the user, with the HTTP status it maps to. */
export class AgentError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

export interface AgentResult {
  blocks: AnswerBlock[];
  tokensIn: number;
  tokensOut: number;
  provider: 'gemini' | 'anthropic';
}

const MAX_TURNS = 6;
const GEMINI_TIMEOUT_MS = 90_000;

/** Claude models that accept output_config.effort, and the subset that accept server-side refusal fallbacks. */
const SUPPORTS_EFFORT = /^claude-(fable|mythos|opus|sonnet|haiku)-5|^claude-opus-4-[5-8]|^claude-sonnet-4-6/;
const SUPPORTS_FALLBACKS = /^claude-(fable-5-[12]|opus-5-5|opus-5|sonnet-5-5)$/;

const MODE_HINT: Record<string, string> = {
  Fast: 'Answer briefly.',
  Balanced: '',
  'Deep Analysis': 'Be thorough: check the data from more than one angle before concluding.',
};

/** Read-only tools over the signed-in user's own ledger. No tool can create, change or delete data. */
const TOOLS = [
  {
    name: 'calculate',
    description: 'Exact arithmetic. Use for every calculation instead of mental math. Supports + - * / ( ) and %.',
    properties: {
      expression: { type: 'string', description: 'Arithmetic expression, e.g. "41260 / 3"' },
      label: { type: 'string', description: 'What this calculation computes' },
    },
    required: ['expression'],
  },
  {
    name: 'query_transactions',
    description: 'Search or filter the company’s transactions in the ledger. Amounts are in dollars; negative is money out.',
    properties: {
      q: { type: 'string', description: 'Search text for payee, memo or id' },
      category: { type: 'string', description: 'Exact category name, e.g. Software, Travel, Payroll' },
      from: { type: 'string', description: 'Earliest date, YYYY-MM-DD' },
      to: { type: 'string', description: 'Latest date, YYYY-MM-DD' },
      limit: { type: 'number', description: 'Max transactions to return (default 10, max 50)' },
      type: { type: 'string', enum: ['all', 'income', 'expense'] },
    },
  },
  {
    name: 'get_financial_summary',
    description: 'Cash on hand, this month’s revenue, expenses and net, monthly averages, runway, and the last 12 months of revenue and expenses.',
    properties: {},
  },
  {
    name: 'get_budgets_status',
    description: 'Every category budget with this month’s actual spend, utilization and status.',
    properties: {},
  },
  {
    name: 'simulate_scenario',
    description: 'Project runway if monthly expenses or revenue change (e.g. a new hire or lost customer), based on the ledger’s recent monthly averages.',
    properties: {
      monthly_expense_delta: { type: 'number', description: 'Change in monthly expenses in dollars (+ for a new hire, - for savings)' },
      monthly_revenue_delta: { type: 'number', description: 'Change in monthly revenue in dollars (+ growth, - churn)' },
    },
  },
] as const;

const usd = (minor: number) => fromMinor(minor);

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly config: ApiConfig = loadConfig();
  private readonly anthropic: Anthropic | null;

  constructor(
    private readonly ledger: LedgerService,
    private readonly financial: FinancialService,
    private readonly budgets: BudgetsService,
  ) {
    this.anthropic = this.config.anthropicKey ? new Anthropic({ apiKey: this.config.anthropicKey }) : null;
    if (this.config.geminiKey) this.logger.log(`Gemini AI enabled with model ${this.config.geminiModel}`);
    if (this.anthropic) this.logger.log(`Anthropic AI enabled with model ${this.config.anthropicModel}`);
  }

  get configured(): boolean {
    return Boolean((this.config.geminiKey && this.config.geminiModel) || this.anthropic);
  }

  get providers() {
    return {
      gemini: Boolean(this.config.geminiKey && this.config.geminiModel),
      anthropic: Boolean(this.anthropic),
    };
  }

  /** Counts this request against the user's daily AI allowance (enforced in Postgres per user). */
  async checkQuota(ctx: UserContext): Promise<void> {
    const { data, error } = await ctx.db.rpc('bump_ai_usage');
    if (error) {
      this.logger.error(`bump_ai_usage failed: ${error.code} ${error.message}`);
      throw new AgentError('The AI is temporarily unavailable. Please try again.', 503);
    }
    if (Number(data) > this.config.aiDailyLimit) {
      throw new AgentError(`You've reached today's limit of ${this.config.aiDailyLimit} AI requests. It resets at midnight UTC.`, 429);
    }
  }

  /** Answers the last user turn in `history`. Tries Gemini first, then Claude. */
  async run(ctx: UserContext, history: HistoryTurn[], mode: ReasoningMode = 'Balanced'): Promise<AgentResult> {
    if (!this.configured) throw new AgentError('The AI is not connected yet. Please try again once your administrator has configured it.', 503);
    let lastError: unknown = null;

    if (this.providers.gemini) {
      try {
        return await this.runGemini(ctx, history, mode);
      } catch (err: any) {
        lastError = err;
        this.logger.error(`Gemini failed: ${err.message}`);
      }
    }
    if (this.anthropic) {
      try {
        return await this.runClaude(ctx, history, mode);
      } catch (err: any) {
        lastError = err;
        this.logger.error(`Claude failed: ${err.message}`);
      }
    }
    if (lastError instanceof AgentError) throw lastError;
    throw new AgentError('The AI service could not complete this request. Please try again.');
  }

  private systemPrompt(mode: ReasoningMode) {
    const today = new Date().toISOString().slice(0, 10);
    return `You are Fremwork AI, a financial copilot for founders, CFOs and accountants. Today is ${today}.
Use your tools to read the user's real ledger. Never invent, estimate or assume financial figures: every number must come from a tool result or from the user.
If the ledger has no data for a question, say so plainly and suggest adding transactions.
Use the calculate tool for arithmetic. You have read-only access; never claim to create or change records.
Return your final answer as a JSON array of blocks, with no other text:
[{"type":"text","text":"Markdown summary"},{"type":"table","head":["..."],"rows":[["..."]]},{"type":"calc","working":"Step 1 = ...","result":"Final figure"},{"type":"recommendation","items":["Action 1"]}]
Include only the blocks the answer needs. ${MODE_HINT[mode] ?? ''}`.trim();
  }

  /** Runs one tool for the signed-in user. Errors come back as data so the model can recover. */
  async executeTool(ctx: UserContext, name: string, input: any): Promise<any> {
    const args = input && typeof input === 'object' ? input : {};
    try {
      switch (name) {
        case 'calculate': {
          const result = calculate(String(args.expression ?? ''));
          return { expression: args.expression, label: args.label, result: +result.toFixed(6) };
        }
        case 'query_transactions': {
          const { rows, totals } = await this.ledger.findAll(ctx, {
            q: typeof args.q === 'string' ? args.q : undefined,
            category: typeof args.category === 'string' ? args.category : undefined,
            from: typeof args.from === 'string' ? args.from : undefined,
            to: typeof args.to === 'string' ? args.to : undefined,
            type: ['all', 'income', 'expense'].includes(args.type) ? args.type : undefined,
            limit: Math.min(50, Math.max(1, Math.floor(Number(args.limit) || 10))),
          });
          return {
            matching: totals.count,
            returned: rows.length,
            moneyIn: usd(totals.moneyInMinor),
            moneyOut: usd(totals.moneyOutMinor),
            transactions: rows.map((t) => ({ id: t.id, date: t.date, payee: t.payee, amount: usd(t.amountMinor), category: t.categoryName, status: t.status, memo: t.memo })),
          };
        }
        case 'get_financial_summary': {
          const f = await this.financial.figures(ctx);
          return {
            hasData: f.hasData,
            month: f.current.label,
            cashOnHand: usd(f.cashOnHandMinor),
            revenueThisMonth: usd(f.current.revenueMinor),
            expensesThisMonth: usd(f.current.expensesMinor),
            netThisMonth: usd(f.current.revenueMinor - f.current.expensesMinor),
            operatingCashFlowThisMonth: usd(f.operatingCashFlowMinor),
            avgMonthlyRevenue: usd(f.avgMonthlyRevenueMinor),
            avgMonthlyExpenses: usd(f.avgMonthlyExpensesMinor),
            runwayMonths: f.runwayMonths,
            flaggedTransactions: f.flaggedCount,
            pendingTransactions: f.pendingCount,
            monthly: f.months.map((m) => ({ month: m.label, revenue: usd(m.revenueMinor), expenses: usd(m.expensesMinor) })),
          };
        }
        case 'get_budgets_status': {
          const list = await this.budgets.findAll(ctx);
          return list.map((b) => {
            const budget = b.amountMinor;
            const spent = b.spentMinor ?? 0;
            const used = budget > 0 ? (spent / budget) * 100 : 0;
            return {
              category: b.categoryName,
              period: b.period,
              budget: usd(budget),
              spent: usd(spent),
              utilizationPct: +used.toFixed(1),
              status: spent > budget ? 'OVER_BUDGET' : used >= b.alertAtPct ? 'NEAR_LIMIT' : 'ON_TRACK',
              owner: b.ownerLabel,
            };
          });
        }
        case 'simulate_scenario': {
          const f = await this.financial.figures(ctx);
          const dExp = Math.round((Number(args.monthly_expense_delta) || 0) * 100);
          const dRev = Math.round((Number(args.monthly_revenue_delta) || 0) * 100);
          const baseNet = f.avgMonthlyRevenueMinor - f.avgMonthlyExpensesMinor;
          const newNet = baseNet + dRev - dExp;
          const runway = (net: number) => (net < 0 && f.cashOnHandMinor > 0 ? +(f.cashOnHandMinor / -net).toFixed(1) : null);
          return {
            hasData: f.hasData,
            cashOnHand: usd(f.cashOnHandMinor),
            baseMonthlyRevenue: usd(f.avgMonthlyRevenueMinor),
            baseMonthlyExpenses: usd(f.avgMonthlyExpensesMinor),
            projectedMonthlyNet: usd(newNet),
            baseRunwayMonths: runway(baseNet) ?? 'Cash flow positive',
            projectedRunwayMonths: runway(newNet) ?? 'Cash flow positive',
          };
        }
        default:
          return { error: `Unknown tool ${name}` };
      }
    } catch (err: any) {
      return { error: err?.response?.message || err?.message || 'Tool failed.' };
    }
  }

  private async runGemini(ctx: UserContext, history: HistoryTurn[], mode: ReasoningMode): Promise<AgentResult> {
    const declarations = TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: 'OBJECT',
        properties: Object.fromEntries(Object.entries(t.properties).map(([k, v]: [string, any]) => [k, { ...v, type: String(v.type).toUpperCase() }])),
        ...('required' in t ? { required: [...t.required] } : {}),
      },
    }));
    const contents: any[] = history.map((h) => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.text }] }));
    const calcBlocks: AnswerBlock[] = [];
    let tokensIn = 0;
    let tokensOut = 0;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: this.systemPrompt(mode) }] },
        contents,
        tools: [{ functionDeclarations: declarations }],
      });
      let response = await this.callGemini(this.config.geminiModel as string, body);
      if ((response.status === 429 || response.status === 503) && this.config.geminiFallbackModel) {
        this.logger.warn(`Gemini ${this.config.geminiModel} returned ${response.status}; retrying with ${this.config.geminiFallbackModel}.`);
        response = await this.callGemini(this.config.geminiFallbackModel, body);
      }
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        this.logger.error(`Gemini HTTP ${response.status}: ${detail}`);
        if (response.status === 429) throw new AgentError('The AI service is busy. Please try again shortly.', 429);
        if (response.status === 404) throw new AgentError('The configured AI model is unavailable. Please contact support.', 503);
        throw new AgentError('The AI service could not complete this request. Please try again.');
      }

      const data: any = await response.json();
      tokensIn += data.usageMetadata?.promptTokenCount || 0;
      tokensOut += data.usageMetadata?.candidatesTokenCount || 0;
      const parts: any[] = data.candidates?.[0]?.content?.parts ?? [];
      if (!parts.length) throw new AgentError('The AI returned an empty answer. Please try again.');

      const calls = parts.filter((p) => p.functionCall);
      if (calls.length) {
        contents.push({ role: 'model', parts });
        const responses: any[] = [];
        for (const { functionCall: fn } of calls) {
          const output = await this.executeTool(ctx, fn.name, fn.args);
          this.recordCalc(fn.name, fn.args, output, calcBlocks);
          responses.push({ functionResponse: { name: fn.name, response: { output }, ...(fn.id ? { id: fn.id } : {}) } });
        }
        contents.push({ role: 'user', parts: responses });
        continue;
      }

      const textOut = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('\n').trim();
      return { blocks: this.finalBlocks(textOut, calcBlocks), tokensIn, tokensOut, provider: 'gemini' };
    }
    throw new AgentError('The AI could not finish this request. Try asking a narrower question.');
  }

  private callGemini(model: string, body: string) {
    return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      // Key in a header, not the URL, so it never lands in proxy or access logs.
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.config.geminiKey as string },
      body,
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
  }

  private async runClaude(ctx: UserContext, history: HistoryTurn[], mode: ReasoningMode): Promise<AgentResult> {
    const client = this.anthropic as Anthropic;
    const model = this.config.anthropicModel;
    const tools: Anthropic.Beta.BetaTool[] = TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: { type: 'object', properties: t.properties as any, ...('required' in t ? { required: [...t.required] } : {}) },
    }));
    const messages: Anthropic.Beta.BetaMessageParam[] = history.map((h) => ({ role: h.role, content: h.text }));
    const calcBlocks: AnswerBlock[] = [];
    let tokensIn = 0;
    let tokensOut = 0;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        system: this.systemPrompt(mode),
        messages,
        tools,
        ...(SUPPORTS_EFFORT.test(model) ? { output_config: { effort: mode === 'Fast' ? 'low' : mode === 'Deep Analysis' ? 'high' : 'medium' } } : {}),
        // On a safety decline, the API re-runs the request on a suitable fallback model.
        ...(SUPPORTS_FALLBACKS.test(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      });
      tokensIn += response.usage.input_tokens;
      tokensOut += response.usage.output_tokens;

      if (response.stop_reason === 'refusal') {
        return { blocks: [{ type: 'text', text: 'I can’t help with that request. Try asking about your ledger, budgets, goals or cash runway.' }], tokensIn, tokensOut, provider: 'anthropic' };
      }

      const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (response.stop_reason === 'tool_use' && toolUses.length) {
        // Thinking and tool-use blocks go back unchanged.
        messages.push({ role: 'assistant', content: response.content as any });
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const use of toolUses) {
          const output = await this.executeTool(ctx, use.name, use.input);
          this.recordCalc(use.name, use.input, output, calcBlocks);
          results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(output), ...(output?.error ? { is_error: true } : {}) });
        }
        messages.push({ role: 'user', content: results });
        continue;
      }

      const textOut = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
      const blocks = this.finalBlocks(textOut, calcBlocks);
      if (response.stop_reason === 'max_tokens') blocks.push({ type: 'text', text: '_The answer was cut short. Ask a narrower question for the rest._' });
      return { blocks, tokensIn, tokensOut, provider: 'anthropic' };
    }
    throw new AgentError('The AI could not finish this request. Try asking a narrower question.');
  }

  private recordCalc(name: string, args: any, output: any, calcBlocks: AnswerBlock[]) {
    if (name === 'calculate' && output?.result !== undefined) {
      calcBlocks.push({ type: 'calc', working: `${args?.label ? `${args.label}: ` : ''}${args?.expression} = ${output.result}`, result: String(output.result) });
    }
  }

  private finalBlocks(text: string, calcBlocks: AnswerBlock[]): AnswerBlock[] {
    const blocks = text ? parseAnswer(text, calcBlocks) : calcBlocks;
    if (!blocks.length) throw new AgentError('The AI returned an empty answer. Please try again.');
    return blocks;
  }
}
