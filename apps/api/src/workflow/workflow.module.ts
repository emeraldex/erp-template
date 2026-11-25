import { Module } from '@nestjs/common';
import { WorkflowEditorController } from './workflow-editor.controller';
import { WorkflowEditorService } from './workflow-editor.service';
import { DictionaryService } from './dictionary.service';

@Module({ controllers: [WorkflowEditorController], providers: [WorkflowEditorService, DictionaryService] })
export class WorkflowModule {}
