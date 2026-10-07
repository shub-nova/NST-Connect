import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsEngine } from './analytics.engine';
import { NotesModule } from '../notes/notes.module';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [NotesModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsEngine, AnalyticsService],
})
export class AnalyticsModule {}
