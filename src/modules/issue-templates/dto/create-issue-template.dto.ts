import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { TaskPriority } from '../../../common/enums/task-priority.enum';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

export class CreateIssueTemplateDto {
  @ApiProperty({ example: 'Customer-reported bug' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Scope this template to one project; omit/null for org-wide',
  })
  @IsOptional()
  @IsObjectId()
  projectId?: string | null;

  @ApiPropertyOptional({ example: 'Bug' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  issueType?: string;

  @ApiPropertyOptional({ example: '[Bug] ' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  titleTemplate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({ enum: TaskPriority, nullable: true })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  labels?: string[];

  @ApiPropertyOptional({
    description: "Keyed by the target project's custom field ids - not validated until applied",
  })
  @IsOptional()
  @IsObject()
  customFieldValues?: Record<string, unknown>;
}
