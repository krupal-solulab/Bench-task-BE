import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsISO8601, IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { TaskPriority } from '../../../common/enums/task-priority.enum';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

const SORT_FIELDS = ['dueDate', 'priority', 'status', 'createdAt', 'updatedAt', 'rank'] as const;
export type TaskSortBy = (typeof SORT_FIELDS)[number];

const toArray = ({ value }: { value: unknown }) =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

export interface CustomFieldFilter {
  fieldId: string;
  value: string;
}

function isCustomFieldFilter(item: unknown): item is CustomFieldFilter {
  return (
    !!item &&
    typeof item === 'object' &&
    typeof (item as CustomFieldFilter).fieldId === 'string' &&
    typeof (item as CustomFieldFilter).value === 'string'
  );
}

/** Parses a JSON-encoded `{fieldId, value}[]` from a single query-string value - malformed JSON,
 * a non-array, or any wrongly-shaped element is dropped rather than causing a 400/500, since a
 * query param can't otherwise carry an array of objects and this filter is purely additive. */
const toCustomFieldFilters = ({ value }: { value: unknown }): CustomFieldFilter[] | undefined => {
  if (typeof value !== 'string') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  return parsed.filter(isCustomFieldFilter);
};

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

  @ApiPropertyOptional({ type: [String], description: "Filter by the project's issue type names" })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsString({ each: true })
  issueType?: string[];

  @ApiPropertyOptional({ description: "An issue's parent (Epic-link or Sub-task's parent)" })
  @IsOptional()
  @IsObjectId()
  parent?: string;

  @ApiPropertyOptional({ isArray: true, description: 'Filter to tasks with any of these labels' })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsString({ each: true })
  labels?: string[];

  @ApiPropertyOptional({
    isArray: true,
    description: 'Filter to tasks with any of these components',
  })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsString({ each: true })
  components?: string[];

  @ApiPropertyOptional({ enum: SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy: TaskSortBy = 'createdAt';

  @ApiPropertyOptional({
    description:
      'JSON-encoded array of {fieldId, value} - equals-match against a custom field, ANDed. ' +
      'Malformed/wrongly-shaped entries are silently dropped rather than rejected.',
  })
  @IsOptional()
  @Transform(toCustomFieldFilters)
  @IsArray()
  customFieldFilters?: CustomFieldFilter[];
}
