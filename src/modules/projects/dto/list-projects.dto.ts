import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { ProjectStatus } from '../../../common/enums/project-status.enum';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

const SORT_FIELDS = ['name', 'status', 'startDate', 'dueDate', 'createdAt'] as const;
export type ProjectSortBy = (typeof SORT_FIELDS)[number];

export class ListProjectsDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ProjectStatus })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObjectId()
  owner?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObjectId()
  member?: string;

  @ApiPropertyOptional({ enum: SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy: ProjectSortBy = 'createdAt';
}
