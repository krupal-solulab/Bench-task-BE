import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { OrganizationStatus } from '../../../common/enums/organization-status.enum';

const SORT_FIELDS = ['name', 'status', 'createdAt'] as const;
export type OrganizationSortBy = (typeof SORT_FIELDS)[number];

export class ListOrganizationsDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: OrganizationStatus })
  @IsOptional()
  @IsEnum(OrganizationStatus)
  status?: OrganizationStatus;

  @ApiPropertyOptional({ enum: SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy: OrganizationSortBy = 'createdAt';
}
