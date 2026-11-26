import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { AuthModule } from '../auth/auth.module';
import { JobsModule } from '../jobs/jobs.module';
import { RequestsInboxController } from './inbox.controller';
import { RequestsInboxService } from './inbox.service';
import { RequestsModule } from './requests.module';

/** Triage, messages and posters: needs both requests and work orders. */
@Module({
  imports: [AuthModule, AttachmentsModule, RequestsModule, JobsModule],
  controllers: [RequestsInboxController],
  providers: [RequestsInboxService],
})
export class RequestsInboxModule {}
