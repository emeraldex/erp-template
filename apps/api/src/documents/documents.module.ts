import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { JobCardService } from './job-card.service';
import { JobCardsController } from './job-cards.controller';

@Module({ controllers: [DocumentsController, JobCardsController], providers: [DocumentsService, JobCardService], exports: [DocumentsService, JobCardService] })
export class DocumentsModule {}
