import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { AnswerBlock, ReasoningMode } from '@fremwork/types';
import { UserContext, badRequest, validId } from '../../common/data/db';
import { AgentError, AgentService } from './agent.service';
import { ConversationsService } from './conversations.service';
import { blocksToMarkdown } from './blocks';

const MODES: ReasoningMode[] = ['Fast', 'Balanced', 'Deep Analysis'];
const MAX_QUESTION = 8000;
const KEEPALIVE_MS = 15_000;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly conversations: ConversationsService,
    private readonly agent: AgentService,
  ) {}

  /** Validates a question before any streaming starts, so bad input gets a normal JSON 400. */
  validate(text: unknown, mode: unknown): { question: string; mode: ReasoningMode } {
    const question = typeof text === 'string' ? text.trim() : '';
    if (!question) badRequest('Enter a question.', 'text');
    if (question.length > MAX_QUESTION) badRequest(`Questions can be at most ${MAX_QUESTION} characters.`, 'text');
    const m = (mode ?? 'Balanced') as ReasoningMode;
    if (!MODES.includes(m)) badRequest(`mode must be one of: ${MODES.join(', ')}.`, 'mode');
    return { question, mode: m };
  }

  /**
   * Answers a question in a conversation over Server-Sent Events:
   * `meta` → one `block` event per answer block → `done`. The question and answer are saved.
   * A conversation id the user doesn't have yet is created (clients may choose ids).
   */
  async streamResponse(ctx: UserContext, conversationId: string, text: unknown, modeIn: unknown, res: Response) {
    const { question, mode } = this.validate(text, modeIn);
    if (!validId(conversationId)) badRequest('Invalid conversation id.', 'id');

    let convo = await this.conversations.find(ctx, conversationId);
    if (!convo) convo = await this.conversations.create(ctx, question.slice(0, 48), { id: conversationId });
    const history = await this.conversations.history(ctx, convo.id);
    await this.conversations.addMessage(ctx, convo.id, { role: 'user', text: question, mode });
    if (convo.title === 'New conversation' && history.length === 0) await this.conversations.rename(ctx, convo.id, question.slice(0, 48));

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let closed = false;
    res.on('close', () => (closed = true));
    const send = (event: string, data: unknown) => {
      if (!closed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    // Proxies close idle streams; a comment line every few seconds keeps long AI calls alive.
    const keepalive = setInterval(() => !closed && !res.writableEnded && res.write(': keepalive\n\n'), KEEPALIVE_MS);

    send('meta', { mode, status: 'streaming', conversationId: convo.id });
    try {
      await this.agent.checkQuota(ctx);
      const result = await this.agent.run(ctx, [...history, { role: 'user', text: question }], mode);
      for (const block of result.blocks) send('block', block);
      await this.conversations.addMessage(ctx, convo.id, { role: 'ai', text: blocksToMarkdown(result.blocks), mode });
      send('done', { status: 'done', tokensIn: result.tokensIn, tokensOut: result.tokensOut });
    } catch (err: any) {
      const message = err instanceof AgentError ? err.message : 'Something went wrong while answering. Please try again.';
      if (!(err instanceof AgentError)) this.logger.error(`Chat failed: ${err?.message}`);
      const block: AnswerBlock = { type: 'text', text: message };
      send('block', block);
      await this.conversations
        .addMessage(ctx, convo.id, { role: 'ai', text: message, mode, status: err?.status === 429 && /limit/.test(message) ? 'limit' : 'error' })
        .catch(() => undefined);
      send('done', { status: 'error', tokensIn: 0, tokensOut: 0 });
    } finally {
      clearInterval(keepalive);
      if (!res.writableEnded) res.end();
    }
  }
}
