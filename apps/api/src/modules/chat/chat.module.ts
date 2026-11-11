import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { AgentService } from './agent.service';
import { ConversationsService } from './conversations.service';
import { LedgerModule } from '../ledger/ledger.module';
import { BudgetsModule } from '../budgets/budgets.module';

@Module({
  imports: [LedgerModule, BudgetsModule],
  controllers: [ChatController],
  providers: [ChatService, AgentService, ConversationsService],
  exports: [ChatService, AgentService, ConversationsService],
})
export class ChatModule {}
