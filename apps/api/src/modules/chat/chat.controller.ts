import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Res,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { Ctx } from '../../common/decorators/user-context.decorator';
import { UserContext, badRequest, text, validId } from '../../common/data/db';
import { ChatService } from './chat.service';
import { ConversationsService } from './conversations.service';

@ApiTags('AI Assistant')
@ApiBearerAuth()
@Controller('conversations')
@UseGuards(AuthGuard, WorkspaceGuard)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly conversations: ConversationsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get recent conversations for sidebar' })
  async getConversations(@Ctx() ctx: UserContext) {
    return { success: true, data: await this.conversations.list(ctx) };
  }

  @Post()
  @ApiOperation({ summary: 'Start a new conversation thread' })
  async createConversation(@Ctx() ctx: UserContext, @Body() body: { id?: string; title?: string; projectId?: string }) {
    const data = body ?? {};
    if (data.id !== undefined && !validId(data.id)) badRequest('Invalid conversation id.', 'id');
    if (data.projectId !== undefined && !validId(data.projectId)) badRequest('Invalid project id.', 'projectId');
    const title = text(data, ['title'], 200)?.trim() || 'New conversation';
    return { success: true, data: await this.conversations.create(ctx, title, { id: data.id, projectId: data.projectId }) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get full conversation thread with message history' })
  async getConversation(@Ctx() ctx: UserContext, @Param('id') id: string) {
    return { success: true, data: await this.conversations.get(ctx, id) };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete conversation thread' })
  async deleteConversation(@Ctx() ctx: UserContext, @Param('id') id: string) {
    if (!(await this.conversations.delete(ctx, id))) {
      throw new NotFoundException({ code: 'not_found', message: 'Conversation not found.' });
    }
    return { success: true, message: 'Conversation deleted.' };
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Ask a question; the answer streams back as Server-Sent Events (meta, block…, done)' })
  async streamMessage(
    @Ctx() ctx: UserContext,
    @Param('id') id: string,
    @Body() body: { text?: string; content?: string; message?: string; mode?: string },
    @Res() res: Response,
  ) {
    const b = body ?? {};
    return this.chatService.streamResponse(ctx, id, b.text ?? b.content ?? b.message, b.mode, res);
  }
}
