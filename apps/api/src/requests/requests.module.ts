import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PublicRequestsController } from './public.controller';
import { JobDoneHook } from './job-hook';
import { RequestsService } from './requests.service';

/** Request data, tracking links, emails and the public routes. Knows nothing of work orders, so JobsModule can import it. */
@Module({
  imports: [AttachmentsModule, NotificationsModule],
  controllers: [PublicRequestsController],
  providers: [RequestsService, { provide: JobDoneHook, useExisting: RequestsService }],
  exports: [RequestsService, JobDoneHook],
})
export class RequestsModule {}
