import { Module } from '@nestjs/common';
import { DataSourcesController } from './data-sources.controller';

@Module({
  controllers: [DataSourcesController],
})
export class DataSourcesModule {}
