import { Module } from '@nestjs/common';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService, STORAGE } from './attachments.service';
import { storageFromEnv } from './storage';

@Module({
  controllers: [AttachmentsController],
  providers: [AttachmentsService, { provide: STORAGE, useFactory: () => storageFromEnv() }],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
