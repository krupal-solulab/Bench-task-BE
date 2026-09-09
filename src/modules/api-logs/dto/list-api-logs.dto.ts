import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsMongoId, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const;
const STATUS_CLASSES = ['2xx', '3xx', '4xx', '5xx'] as const;

export class ListApiLogsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter to a single organization' })
  @IsOptional()
  @IsMongoId()
  organizationId?: string;

  @ApiPropertyOptional({ enum: METHODS })
  @IsOptional()
  @IsIn(METHODS)
  method?: (typeof METHODS)[number];

  @ApiPropertyOptional({ description: 'Exact status code, e.g. 404' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  statusCode?: number;

  @ApiPropertyOptional({
    enum: STATUS_CLASSES,
    description: 'Coarse status filter; ignored if statusCode is set',
  })
  @IsOptional()
  @IsIn(STATUS_CLASSES)
  statusClass?: (typeof STATUS_CLASSES)[number];

  @ApiPropertyOptional({ description: 'Case-insensitive substring match against the request path' })
  @IsOptional()
  @IsString()
  path?: string;

  @ApiPropertyOptional({ description: 'ISO date - only logs at or after this instant' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'ISO date - only logs at or before this instant' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
