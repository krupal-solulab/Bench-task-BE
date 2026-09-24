import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsEnum, IsOptional } from 'class-validator';
import { StatusCategory } from '../../../common/enums/status-category.enum';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

/** Module 1's roadmap filtering - by project and by status. "Team" and "project category"
 * filters from the BRD are deferred until those entities exist (Modules 6/8 respectively). */
export class RoadmapQueryDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Restrict to these project ids (a subset of what the caller can already access)',
  })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsArray()
  @IsObjectId({ each: true })
  projectIds?: string[];

  @ApiPropertyOptional({ enum: StatusCategory })
  @IsOptional()
  @IsEnum(StatusCategory)
  status?: StatusCategory;
}
