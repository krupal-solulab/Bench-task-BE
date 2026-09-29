import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsEnum, IsOptional } from 'class-validator';
import { StatusCategory } from '../../../common/enums/status-category.enum';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

/** Module 1's roadmap filtering - by project, by status, and by team (a project matches when the
 * team is granted any Project Role on it via `Project.roleAssignments[].teamIds` - Module 6's own
 * Team-to-Project relationship, reused as-is rather than inventing a second one). "Project
 * category" filtering is still deferred until that entity exists (Module 8). */
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

  @ApiPropertyOptional({
    description: 'Restrict to projects this team is granted a role assignment on',
  })
  @IsOptional()
  @IsObjectId()
  teamId?: string;
}
