import { Module } from '@nestjs/common';
import { Mailer } from './mailer';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({ controllers: [NotificationsController], providers: [NotificationsService, Mailer], exports: [NotificationsService, Mailer] })
export class NotificationsModule {}
