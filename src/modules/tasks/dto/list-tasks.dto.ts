import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsISO8601, IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { IssueType } from '../../../common/enums/issue-type.enum';
import { TaskPriority } from '../../../common/enums/task-priority.enum';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

const SORT_FIELDS = ['dueDate', 'priority', 'status', 'createdAt', 'updatedAt', 'rank'] as const;
export type TaskSortBy = (typeof SORT_FIELDS)[number];

const toArray = ({ value }: { value: unknown }) =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

export class ListTasksDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsObjectId()
  project?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObjectId()
  assignee?: string;

  @ApiPropertyOptional({
    isArray: true,
    description: "Status name(s) from the project's workflow (custom or system default)",
  })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsString({ each: true })
  status?: string[];

  @ApiPropertyOptional({ enum: TaskPriority, isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsEnum(TaskPriority, { each: true })
  priority?: TaskPriority[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  dueDateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  dueDateTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  overdue?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObjectId()
  createdBy?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObjectId()
  sprintId?: string;

  @ApiPropertyOptional({ description: 'true = only backlog tasks (no sprint assigned)' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  unassignedSprint?: boolean;

  @ApiPropertyOptional({ enum: IssueType, isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsEnum(IssueType, { each: true })
  issueType?: IssueType[];

  @ApiPropertyOptional({ description: "An issue's parent (Epic-link or Sub-task's parent)" })
  @IsOptional()
  @IsObjectId()
  parent?: string;

  @ApiPropertyOptional({ enum: SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy: TaskSortBy = 'createdAt';
}
