import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationsModule } from '../notifications/notifications.module';
import { RetentionModule } from '../retention/retention.module';
import { SchedulerService } from './scheduler.service';

@Module({ imports: [ScheduleModule.forRoot(), NotificationsModule, RetentionModule, AssetsModule], providers: [SchedulerService] })
export class SchedulerModule {}
