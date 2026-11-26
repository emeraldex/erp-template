import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationsModule } from '../notifications/notifications.module';
import { RetentionModule } from '../retention/retention.module';
import { SchedulerService } from './scheduler.service';
import { RequestsModule } from '../requests/requests.module';

@Module({ imports: [ScheduleModule.forRoot(), NotificationsModule, RetentionModule, AssetsModule, RequestsModule], providers: [SchedulerService] })
export class SchedulerModule {}
