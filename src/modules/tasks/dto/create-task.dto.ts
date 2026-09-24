import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IssueType } from '../../../common/enums/issue-type.enum';
import { TaskPriority } from '../../../common/enums/task-priority.enum';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

export class CreateTaskDto {
  @ApiProperty({ example: 'Set up CI pipeline' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiProperty()
  @IsObjectId()
  project!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsObjectId()
  assignee?: string | null;

  @ApiProperty({ enum: TaskPriority })
  @IsEnum(TaskPriority)
  priority!: TaskPriority;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsISO8601()
  dueDate?: string | null;

  @ApiPropertyOptional({
    example: IssueType.TASK,
    default: IssueType.TASK,
    description:
      "One of the project's enabled issue types (the 5 built-ins, or a custom Standard-level " +
      'type the Org Admin added) - validated against the project, not a fixed list.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  issueType?: string;

  @ApiPropertyOptional({
    description: 'Epic-link (for Story/Task/Bug) or required parent (for Sub-task)',
  })
  @IsOptional()
  @IsObjectId()
  parent?: string;

  @ApiPropertyOptional({ description: 'Story/Task/Bug only' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  storyPoints?: number;

  @ApiPropertyOptional({ type: [String], description: 'Free-form tags' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  labels?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: "Must be names already defined in the project's component list",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  components?: string[];

  @ApiPropertyOptional({
    description:
      "Keyed by the project's custom field ids. Value shape is validated per-field's type.",
  })
  @IsOptional()
  @IsObject()
  customFieldValues?: Record<string, unknown>;

  @ApiPropertyOptional({
    type: [String],
    description: 'Release id(s) this issue targets ("Fix Version") - must belong to the project',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsObjectId({ each: true })
  fixVersions?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Release id(s) this issue affects ("Affects Version") - must belong to the project',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsObjectId({ each: true })
  affectsVersions?: string[];
}
