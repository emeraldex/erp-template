import { Module } from '@nestjs/common';
import { WorkflowEditorController } from './workflow-editor.controller';
import { WorkflowEditorService } from './workflow-editor.service';

@Module({ controllers: [WorkflowEditorController], providers: [WorkflowEditorService] })
export class WorkflowModule {}
