import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { SupabaseModule } from './modules/supabase/supabase.module';
import { HealthModule } from './modules/health/health.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { BudgetsModule } from './modules/budgets/budgets.module';
import { GoalsModule } from './modules/goals/goals.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { DataSourcesModule } from './modules/data-sources/data-sources.module';
import { ChatModule } from './modules/chat/chat.module';
import { OverviewModule } from './modules/overview/overview.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';

@Module({
  imports: [
    // Local development reads .env files; on Render the variables come from the service's environment.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    SupabaseModule,
    HealthModule,
    WorkspacesModule,
    LedgerModule,
    BudgetsModule,
    GoalsModule,
    ProjectsModule,
    TasksModule,
    DataSourcesModule,
    ChatModule,
    OverviewModule,
    AnalyticsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
