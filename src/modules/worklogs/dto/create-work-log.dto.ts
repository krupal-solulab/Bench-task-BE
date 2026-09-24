import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateWorkLogDto {
  @ApiProperty({ example: 2.5, description: 'Hours worked (0.1 - 24)' })
  @IsNumber()
  @Min(0.1)
  @Max(24)
  hours!: number;

  @ApiPropertyOptional({ example: 'Investigated the flaky test' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ example: '2026-03-01', description: 'The day the work was actually done' })
  @IsISO8601()
  workDate!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  billable?: boolean;
}
