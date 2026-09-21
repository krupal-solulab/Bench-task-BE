import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  MinLength,
} from 'class-validator';

export const SPRINT_DURATION_WEEKS = [1, 2, 3, 4] as const;
export type SprintDurationWeeks = (typeof SPRINT_DURATION_WEEKS)[number];

export class CreateSprintDto {
  @ApiProperty({ example: 'Sprint 12' })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ example: 'Ship the new onboarding flow.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  goal?: string;

  @ApiProperty({ example: '2026-09-15' })
  @IsISO8601()
  startDate!: string;

  @ApiPropertyOptional({
    example: '2026-09-29',
    description: 'Required unless durationWeeks is given (a custom date range).',
  })
  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @ApiPropertyOptional({
    enum: SPRINT_DURATION_WEEKS,
    description:
      'A preset sprint length (BRD 6.3) - when given, endDate is computed server-side ' +
      '(startDate + N weeks) and any client-supplied endDate is ignored.',
  })
  @IsOptional()
  @IsIn(SPRINT_DURATION_WEEKS)
  durationWeeks?: SprintDurationWeeks;

  @ApiPropertyOptional({
    description: 'Team capacity in story points, for the planning capacity indicator.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  capacityPoints?: number;
}
