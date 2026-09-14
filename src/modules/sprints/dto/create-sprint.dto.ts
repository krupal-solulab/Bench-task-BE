import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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

  @ApiProperty({ example: '2026-09-29' })
  @IsISO8601()
  endDate!: string;
}
