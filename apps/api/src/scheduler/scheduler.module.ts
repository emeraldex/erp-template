import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationsModule } from '../notifications/notifications.module';
import { RetentionModule } from '../retention/retention.module';
import { SchedulerService } from './scheduler.service';

@Module({ imports: [ScheduleModule.forRoot(), NotificationsModule, RetentionModule], providers: [SchedulerService] })
export class SchedulerModule {}
