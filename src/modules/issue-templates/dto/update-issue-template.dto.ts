import { PartialType } from '@nestjs/swagger';
import { CreateIssueTemplateDto } from './create-issue-template.dto';

export class UpdateIssueTemplateDto extends PartialType(CreateIssueTemplateDto) {}
