import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsISO8601,
  IsInt,
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

  @ApiPropertyOptional({ enum: IssueType, default: IssueType.TASK })
  @IsOptional()
  @IsEnum(IssueType)
  issueType?: IssueType;

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
}
