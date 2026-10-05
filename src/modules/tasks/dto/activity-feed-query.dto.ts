import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';

/** Module 11 gap-closure: the activity feed - newest first, paged by a `before` cursor. */
export class ActivityFeedQueryDto {
  @ApiPropertyOptional({
    description: "Only entries older than this (the previous page's nextBefore)",
  })
  @IsOptional()
  @IsISO8601()
  before?: string;

  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 30;

  @ApiPropertyOptional({
    enum: ['all', 'involved'],
    default: 'all',
    description: '"involved" = issues I created, am assigned to, or watch',
  })
  @IsOptional()
  @IsIn(['all', 'involved'])
  scope: 'all' | 'involved' = 'all';
}
