import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsMongoId, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { AuditAction } from '../schemas/audit-log-entry.schema';

export class ListAuditLogDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AuditAction })
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @ApiPropertyOptional({ description: 'Filter to entries performed by one actor (user id)' })
  @IsOptional()
  @IsMongoId()
  actorId?: string;

  @ApiPropertyOptional({ description: 'ISO date - only entries at or after this instant' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'ISO date - only entries at or before this instant' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
