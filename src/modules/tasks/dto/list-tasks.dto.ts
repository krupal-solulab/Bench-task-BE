import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsISO8601, IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { TaskPriority } from '../../../common/enums/task-priority.enum';
import { TaskStatus } from '../../../common/enums/task-status.enum';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

const SORT_FIELDS = ['dueDate', 'priority', 'status', 'createdAt', 'updatedAt'] as const;
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

  @ApiPropertyOptional({ enum: TaskStatus, isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsEnum(TaskStatus, { each: true })
  status?: TaskStatus[];

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

  @ApiPropertyOptional({ enum: SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy: TaskSortBy = 'createdAt';
}
