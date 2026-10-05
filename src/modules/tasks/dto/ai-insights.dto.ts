import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

// Module 10 gap-closure: query DTOs for the deterministic duplicate-detection and risk endpoints.
export class SimilarIssuesQueryDto {
  @ApiProperty()
  @IsObjectId()
  project!: string;

  @ApiProperty({ description: 'The title (and optionally description) being typed' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;

  @ApiPropertyOptional({ description: 'Leave this task out (e.g. when editing it)' })
  @IsOptional()
  @IsObjectId()
  excludeId?: string;
}

export class AtRiskQueryDto {
  @ApiProperty()
  @IsObjectId()
  project!: string;
}
