import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { Conversation, AnswerBlock, ReasoningMode, Message } from '@fremwork/types';
import { LedgerService } from '../ledger/ledger.service';
import { BudgetsService } from '../budgets/budgets.service';
import { WorkersService } from '../workers/workers.service';

export interface ToolCallRecord {
  tool: string;
  args: any;
  result: any;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private anthropic: Anthropic | null = null;
  private geminiApiKey: string | null = null;
  private geminiModel: string = 'gemini-3.6-flash';

  private conversations: Conversation[] = [];

  constructor(
    private readonly ledgerService: LedgerService,
    private readonly budgetsService: BudgetsService,
    private readonly workersService: WorkersService,
  ) {
    // 1. Google Gemini AI configuration
    const rawGeminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
    this.geminiApiKey = rawGeminiKey && !rawGeminiKey.includes('your_') ? rawGeminiKey : null;
    this.geminiModel = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
    if (this.geminiApiKey) {
      this.logger.log(`Google Gemini AI initialized with model ${this.geminiModel}`);
    }

    // 2. Anthropic Claude AI configuration
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
      this.logger.log('Anthropic Claude AI initialized with API key.');
    }

    if (!this.geminiApiKey && !this.anthropic) {
      this.logger.warn('No AI keys provided. Chat will report that the AI is not connected.');
    }
  }

  getConversations(workspaceId: string): Conversation[] {
    return this.conversations.filter((c) => c.workspaceId === workspaceId);
  }

  getConversation(workspaceId: string, id: string): Conversation {
    const convo = this.conversations.find((c) => c.id === id && c.workspaceId === workspaceId);
    if (!convo) {
      throw new NotFoundException({
        code: 'not_found',
        message: 'Conversation not found.',
      });
    }
    return convo;
  }

  createConversation(workspaceId: string, userId: string, title?: string, projectId?: string): Conversation {
    const id = `c-${Date.now().toString(36)}`;
    const convo: Conversation = {
      id,
      workspaceId,
      title: title || 'New conversation',
      projectId,
      createdBy: userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };
    this.conversations.unshift(convo);
    return convo;
  }

  deleteConversation(workspaceId: string, id: string): boolean {
    const len = this.conversations.length;
    this.conversations = this.conversations.filter((c) => !(c.id === id && c.workspaceId === workspaceId));
    return this.conversations.length < len;
  }

  /**
   * Core tools available to the AI Assistant
   */
  private getToolDefinitions() {
    return [
      {
        name: 'calculate',
        description: 'Perform exact arithmetic calculation. Claude must never guess numbers or mental math.',
        input_schema: {
          type: 'object',
          properties: {
            expression: { type: 'string', description: 'Mathematical expression (e.g. "1200 / 300")' },
            label: { type: 'string', description: 'What this calculation computes' },
          },
          required: ['expression'],
        },
      },
      {
        name: 'query_transactions',
        description: 'Search or filter company transactions from the unified ledger.',
        input_schema: {
          type: 'object',
          properties: {
            q: { type: 'string', description: 'Search query for payee or memo' },
            category: { type: 'string', description: 'Category name filter (Software, Travel, Payroll, etc.)' },
            limit: { type: 'number', description: 'Max records to fetch (default 10)' },
            type: { type: 'string', enum: ['all', 'income', 'expense'] },
          },
        },
      },

      {
        name: 'get_financial_summary',
        description: 'Fetch cash balance, revenue, expenses, net profit, and runway months.',
        input_schema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_budgets_status',
        description: 'Fetch all department budget allocations, actual spend, and variance.',
        input_schema: {
          type: 'object',
          properties: {},
        },
      },

      {
        name: 'simulate_scenario',
        description: 'Simulate financial runway impact under hiring, spending increases, or revenue changes.',
        input_schema: {
          type: 'object',
          properties: {
            monthly_expense_delta: { type: 'number', description: 'Change in monthly burn (+ for new hire, - for savings)' },
            monthly_revenue_delta: { type: 'number', description: 'Change in monthly revenue (+ for growth, - for churn)' },
          },
        },
      },
    ];
  }

  /**
   * Execute an individual tool against the workspace database
   */
  async executeTool(workspaceId: string, name: string, input: any): Promise<any> {
    switch (name) {
      case 'calculate': {
        const cleanExpr = String(input.expression).replace(/[^0-9.+\-*/() ]/g, '');
        try {
          // Safe evaluation using Function
          const val = Function(`'use strict'; return (${cleanExpr})`)();
          return {
            expression: input.expression,
            label: input.label,
            result: Number(val),
            formatted: typeof val === 'number' ? val.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(val),
          };
        } catch (e: any) {
          return { expression: input.expression, error: e.message };
        }
      }

      case 'query_transactions': {
        const { rows, totals } = this.ledgerService.findAll(workspaceId, {
          q: input.q,
          category: input.category,
          limit: input.limit || 10,
          type: input.type,
        });
        return {
          count: rows.length,
          totals: {
            moneyIn: `$${(totals.moneyInMinor / 100).toLocaleString()}`,
            moneyOut: `$${(totals.moneyOutMinor / 100).toLocaleString()}`,
          },
          transactions: rows.map((r) => ({
            id: r.id,
            date: r.date,
            payee: r.payee,
            amount: `$${(r.amountMinor / 100).toLocaleString()}`,
            category: r.categoryName,
            status: r.status,
            memo: r.memo,
          })),
        };
      }



      case 'get_financial_summary': {
        const figures = this.ledgerService.getOverviewFigures(workspaceId);
        return {
          cashOnHand: figures.cashOnHandMinor / 100,
          octoberRevenue: figures.octoberRevMinor / 100,
          octoberExpenses: figures.octoberExpMinor / 100,
          netProfit: figures.octoberNetMinor / 100,
          operatingCashFlow: figures.operatingCashFlowMinor / 100,
          runwayMonths: figures.runwayMonths,
          flaggedTransactionsCount: figures.flaggedCount,
        };
      }

      case 'get_budgets_status': {
        const budgets = this.budgetsService.findAll(workspaceId);
        return budgets.map((b) => {
          const budgetDollars = (b.amountMinor ?? 0) / 100;
          const spentDollars = (b.spentMinor ?? 0) / 100;
          const pct = budgetDollars > 0 ? (spentDollars / budgetDollars) * 100 : 0;
          return {
            category: b.categoryName,
            budget: `$${budgetDollars.toLocaleString()}`,
            spent: `$${spentDollars.toLocaleString()}`,
            utilization: `${pct.toFixed(1)}%`,
            status: spentDollars > budgetDollars ? 'OVER_BUDGET' : pct >= 90 ? 'NEAR_LIMIT' : 'ON_TRACK',
            owner: b.ownerLabel,
          };
        });
      }



      case 'simulate_scenario': {
        const figures = this.ledgerService.getOverviewFigures(workspaceId);
        const cash = figures.cashOnHandMinor / 100;
        const baseBurn = figures.octoberExpMinor / 100;
        const baseRev = figures.octoberRevMinor / 100;

        const dCost = Number(input.monthly_expense_delta || 0);
        const dRev = Number(input.monthly_revenue_delta || 0);

        const newBurn = baseBurn + dCost;
        const newRev = baseRev + dRev;
        const newNet = newRev - newBurn;

        const baseRunway = cash / (baseBurn || 1);
        const newRunway = newNet < 0 ? cash / Math.abs(newNet) : null;

        return {
          cash,
          baseBurn,
          projectedBurn: newBurn,
          projectedNet: newNet,
          baseRunwayMonths: +baseRunway.toFixed(1),
          projectedRunwayMonths: newRunway !== null ? +newRunway.toFixed(1) : 'Cash flow positive',
          differenceMonths: newRunway !== null ? +(newRunway - baseRunway).toFixed(1) : null,
        };
      }

      default:
        return { error: `Unknown tool ${name}` };
    }
  }

  /**
   * Stream typed answer blocks over Server-Sent Events (SSE)
   */
  async streamResponse(
    workspaceId: string,
    conversationId: string,
    text: string,
    mode: ReasoningMode = 'Balanced',
    res: Response,
  ) {
    const queryText = (text || '').trim();
    let convo = this.conversations.find((c) => c.id === conversationId && c.workspaceId === workspaceId);
    if (!convo) {
      convo = this.createConversation(workspaceId, 'usr-1', (queryText || 'New conversation').slice(0, 48));
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Stream meta
    res.write(`event: meta\ndata: ${JSON.stringify({ mode, status: 'streaming' })}\n\n`);

    const blocks: AnswerBlock[] = [];

    // 1. Check if Gemini API is available
    if (this.geminiApiKey) {
      try {
        const handled = await this.handleGeminiStream(workspaceId, text, res, blocks);
        if (handled) return;
      } catch (err: any) {
        this.logger.error(`Gemini API error: ${err.message}. Trying next provider.`);
      }
    }

    // 2. Check if Claude API is available
    if (this.anthropic) {
      try {
        await this.handleClaudeStream(workspaceId, text, res, blocks);
        return;
      } catch (err: any) {
        this.logger.error(`Claude API error: ${err.message}. No provider left.`);
      }
    }

    this.sendBlock(res, { type: 'text', text: 'The AI is not available right now. Check GEMINI_API_KEY and GEMINI_MODEL, then try again.' }, blocks);
    this.sendDone(res, 0, 0);
  }

  private async handleClaudeStream(
    workspaceId: string,
    prompt: string,
    res: Response,
    blocks: AnswerBlock[],
  ) {
    if (!this.anthropic) return;

    const tools = this.getToolDefinitions();
    const systemPrompt = `You are Fremwork AI, an elite autonomous financial copilot for CFOs, founders, and accountants.
You calculate with mathematical precision and NEVER guess numbers. You have access to tools for querying transactions, calculating exact arithmetic, checking budgets, and running financial scenarios.
Your answers are returned as an array of structured JSON blocks:
[
  { "type": "text", "text": "Markdown summary" },
  { "type": "table", "head": [...], "rows": [[...]], "foot": [...] },
  { "type": "calc", "working": "Step 1 = ...\\nStep 2 = ...", "result": "Final figure" },
  { "type": "recommendation", "items": ["Action 1", "Action 2"] }
]
Always invoke the calculate tool for arithmetic steps. Return valid JSON blocks.`;

    let messages: any[] = [{ role: 'user', content: prompt }];
    let hasMoreTurns = true;
    let turnCount = 0;

    while (hasMoreTurns && turnCount < 5) {
      turnCount++;
      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1500,
        system: systemPrompt,
        messages,
        tools: tools as any,
      });

      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
        messages.push({ role: 'assistant', content: response.content });

        const toolResponses: any[] = [];
        for (const toolUse of toolUseBlocks) {
          if (toolUse.type === 'tool_use') {
            const result = await this.executeTool(workspaceId, toolUse.name, toolUse.input);
            toolResponses.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: JSON.stringify(result),
            });
          }
        }

        messages.push({ role: 'user', content: toolResponses });
      } else {
        hasMoreTurns = false;
        // Parse final response content
        for (const c of response.content) {
          if (c.type === 'text') {
            try {
              const parsed = JSON.parse(c.text);
              if (Array.isArray(parsed)) {
                for (const blk of parsed) {
                  this.sendBlock(res, blk, blocks);
                }
                break;
              }
            } catch {
              // Raw text block fallback
              this.sendBlock(res, { type: 'text', text: c.text }, blocks);
            }
          }
        }
        this.sendDone(res, response.usage.input_tokens, response.usage.output_tokens);
      }
    }
  }

  private getGeminiToolDeclarations() {
    return [
      {
        name: 'calculate',
        description: 'Perform exact arithmetic calculation. Claude and Gemini must never guess numbers or mental math.',
        parameters: {
          type: 'OBJECT',
          properties: {
            expression: { type: 'STRING', description: 'Mathematical expression (e.g. "1200 / 300")' },
            label: { type: 'STRING', description: 'What this calculation computes' },
          },
          required: ['expression'],
        },
      },
      {
        name: 'query_transactions',
        description: 'Search or filter company transactions from the unified ledger.',
        parameters: {
          type: 'OBJECT',
          properties: {
            q: { type: 'STRING', description: 'Search query for payee or memo' },
            category: { type: 'STRING', description: 'Category name filter (Software, Travel, Payroll, etc.)' },
            limit: { type: 'NUMBER', description: 'Max records to fetch (default 10)' },
            type: { type: 'STRING', enum: ['all', 'income', 'expense'] },
          },
        },
      },

      {
        name: 'get_financial_summary',
        description: 'Fetch cash balance, revenue, expenses, net profit, and runway months.',
        parameters: {
          type: 'OBJECT',
          properties: {},
        },
      },
      {
        name: 'get_budgets_status',
        description: 'Fetch all department budget allocations, actual spend, and variance.',
        parameters: {
          type: 'OBJECT',
          properties: {},
        },
      },

      {
        name: 'simulate_scenario',
        description: 'Simulate financial runway impact under hiring, spending increases, or revenue changes.',
        parameters: {
          type: 'OBJECT',
          properties: {
            monthly_expense_delta: { type: 'NUMBER', description: 'Change in monthly burn (+ for new hire, - for savings)' },
            monthly_revenue_delta: { type: 'NUMBER', description: 'Change in monthly revenue (+ for growth, - for churn)' },
          },
        },
      },
    ];
  }

  private async handleGeminiStream(
    workspaceId: string,
    prompt: string,
    res: Response,
    blocks: AnswerBlock[],
  ): Promise<boolean> {
    if (!this.geminiApiKey) return false;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent?key=${this.geminiApiKey}`;
    const systemInstruction = {
      parts: [
        {
          text: `You are Fremwork AI, an elite autonomous financial copilot for CFOs, founders, and accountants.
You calculate with mathematical precision and NEVER guess numbers. You have access to tools for querying transactions, calculating exact arithmetic, checking budgets, and running financial scenarios.
Always invoke the calculate tool for arithmetic steps.
Always return your final response strictly as a JSON array of blocks:
[
  { "type": "text", "text": "Markdown summary" },
  { "type": "table", "head": [...], "rows": [[...]], "foot": [...] },
  { "type": "calc", "working": "Step 1 = ...\\nStep 2 = ...", "result": "Final figure" },
  { "type": "recommendation", "items": ["Action 1", "Action 2"] }
]`,
        },
      ],
    };

    const tools = [{ functionDeclarations: this.getGeminiToolDeclarations() }];
    const contents: any[] = [{ role: 'user', parts: [{ text: prompt }] }];
    const calcBlocks: AnswerBlock[] = [];

    let turnCount = 0;
    let tokensIn = 0;
    let tokensOut = 0;

    while (turnCount < 5) {
      turnCount++;
      const payload = {
        systemInstruction,
        contents,
        tools,
      };

      let response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      // Handle transient 503 or 429 spikes by retrying with flash-lite
      if (response.status === 503 || response.status === 429) {
        this.logger.warn(`Gemini ${this.geminiModel} returned status ${response.status}. Retrying with gemini-3.5-flash-lite fallback...`);
        await new Promise((r) => setTimeout(r, 1000));
        const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${this.geminiApiKey}`;
        response = await fetch(fallbackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      if (!response.ok) {
        const errText = await response.text();
        this.logger.error(`Gemini API error status ${response.status}: ${errText}`);
        return false;
      }

      const data: any = await response.json();
      const candidate = data.candidates?.[0];
      if (!candidate || !candidate.content) {
        return false;
      }

      tokensIn += data.usageMetadata?.promptTokenCount || 0;
      tokensOut += data.usageMetadata?.candidatesTokenCount || 0;

      const parts = candidate.content.parts || [];
      const functionCallParts = parts.filter((p: any) => p.functionCall);

      if (functionCallParts.length > 0) {
        // Model requested one or more tool calls in this turn
        contents.push({ role: 'model', parts });

        const responseParts: any[] = [];
        for (const fcp of functionCallParts) {
          const fn = fcp.functionCall;
          this.logger.log(`Gemini tool call: ${fn.name}(${JSON.stringify(fn.args)}) [id: ${fn.id || 'none'}]`);
          const result = await this.executeTool(workspaceId, fn.name, fn.args);

          if (fn.name === 'calculate' && fn.args?.expression && result?.result !== undefined) {
            calcBlocks.push({
              type: 'calc',
              working: `${fn.args.label ? `${fn.args.label}: ` : ''}${fn.args.expression} = ${result.result}`,
              result: String(result.result),
            });
          }

          const respPayload: any = {
            name: fn.name,
            response: { output: result },
          };
          if (fn.id) {
            respPayload.id = fn.id;
          }
          responseParts.push({ functionResponse: respPayload });
        }

        contents.push({
          role: 'user',
          parts: responseParts,
        });
        continue;
      }

      // Final response produced: filter out internal thought parts
      const textParts = parts.filter((p: any) => p.text && !p.thought);
      const combinedText = textParts.map((p: any) => p.text).join('\n').trim();

      if (combinedText) {
        this.parseAndSendResponseBlocks(combinedText, calcBlocks, res, blocks);
      } else if (calcBlocks.length > 0) {
        for (const cb of calcBlocks) {
          this.sendBlock(res, cb, blocks);
        }
      }

      this.sendDone(res, tokensIn, tokensOut);
      return true;
    }

    return false;
  }

  private parseAndSendResponseBlocks(
    text: string,
    calcBlocks: AnswerBlock[],
    res: Response,
    blocks: AnswerBlock[],
  ) {
    let cleanText = text.trim();

    // 1. Check if the output is a fenced JSON block
    const jsonMatch = cleanText.match(/```(?:json)?\s*(\[\s*\{[\s\S]*\}\s*\])\s*```/);
    if (jsonMatch) {
      cleanText = jsonMatch[1].trim();
    } else if (cleanText.startsWith('```json')) {
      cleanText = cleanText.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
    }

    // Attempt direct JSON array parsing
    try {
      const parsed = JSON.parse(cleanText);
      if (Array.isArray(parsed) && parsed.length > 0) {
        let hasCalc = false;
        for (const blk of parsed) {
          if (blk.type === 'calc') hasCalc = true;
          this.sendBlock(res, blk, blocks);
        }
        if (!hasCalc && calcBlocks.length > 0) {
          for (const cb of calcBlocks) {
            this.sendBlock(res, cb, blocks);
          }
        }
        return;
      }
    } catch {
      // Not pure JSON; fall through to intelligent markdown/block extraction
    }

    // 2. Intelligent Markdown to Typed Blocks Extraction
    // First, emit any calculation blocks from tool execution
    for (const cb of calcBlocks) {
      this.sendBlock(res, cb, blocks);
    }

    // Check for markdown tables: lines starting with |
    const lines = text.split('\n');
    const narrativeLines: string[] = [];
    const tableLines: string[] = [];
    const recLines: string[] = [];
    let inTable = false;
    let inRec = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (/^(?:###?\s*)?recommendation/i.test(trimmed)) {
        inRec = true;
        inTable = false;
        continue;
      }

      if (inRec) {
        if (/^[-*•]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
          recLines.push(trimmed.replace(/^[-*•\d.]+\s*/, ''));
        } else if (trimmed) {
          recLines.push(trimmed);
        }
        continue;
      }

      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        inTable = true;
        tableLines.push(trimmed);
      } else {
        if (inTable && trimmed === '') {
          inTable = false;
        } else {
          narrativeLines.push(line);
        }
      }
    }

    // Emit narrative text block
    const narrativeText = narrativeLines.join('\n').trim();
    if (narrativeText) {
      this.sendBlock(res, { type: 'text', text: narrativeText }, blocks);
    }

    // Parse and emit table block if found
    if (tableLines.length >= 2) {
      const parseRow = (r: string) =>
        r
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim());
      const head = parseRow(tableLines[0]);
      // Skip delimiter row (e.g. |---|---|)
      const dataRows = tableLines.slice(1).filter((r) => !/^[|\s-:]+$/.test(r));
      const rows = dataRows.map(parseRow);

      if (head.length > 0 && rows.length > 0) {
        this.sendBlock(res, { type: 'table', head, rows }, blocks);
      }
    }

    // Emit recommendation block if found
    if (recLines.length > 0) {
      this.sendBlock(res, { type: 'recommendation', items: recLines }, blocks);
    }
  }

  private sendBlock(res: Response, block: AnswerBlock, blocks: AnswerBlock[]) {
    blocks.push(block);
    res.write(`event: block\ndata: ${JSON.stringify(block)}\n\n`);
  }

  private sendDone(res: Response, tokensIn: number, tokensOut: number) {
    res.write(`event: done\ndata: ${JSON.stringify({ status: 'done', tokensIn, tokensOut })}\n\n`);
    res.end();
  }
}
