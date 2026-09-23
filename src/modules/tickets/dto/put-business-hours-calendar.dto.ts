import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class BusinessHoursWindowDto {
  @ApiProperty({ example: '09:00', description: '24h "HH:mm" local time' })
  @IsString()
  @Matches(HHMM_PATTERN)
  start!: string;

  @ApiProperty({ example: '18:00', description: '24h "HH:mm" local time' })
  @IsString()
  @Matches(HHMM_PATTERN)
  end!: string;
}

export class PutBusinessHoursCalendarDto {
  @ApiProperty({
    type: [Number],
    example: [1, 2, 3, 4, 5],
    description: '0 = Sunday ... 6 = Saturday',
  })
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  workingDays!: number[];

  @ApiProperty({ type: BusinessHoursWindowDto })
  @ValidateNested()
  @Type(() => BusinessHoursWindowDto)
  workingHours!: BusinessHoursWindowDto;

  @ApiProperty({ type: [String], example: ['2026-12-25'], description: '"YYYY-MM-DD" local dates' })
  @IsArray()
  @ArrayMaxSize(200)
  @Matches(ISO_DATE_PATTERN, { each: true })
  holidays!: string[];
}
