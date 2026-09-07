import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

export class CreateProjectDto {
  @ApiProperty({ example: 'Website Redesign' })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ example: 'Revamp the marketing site.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ example: '2026-01-01', description: 'Defaults to today if omitted.' })
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsISO8601()
  dueDate?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsObjectId({ each: true })
  @Type(() => String)
  memberIds?: string[];

  @ApiPropertyOptional({ description: 'Admin only: assign a different Manager/Admin as owner' })
  @IsOptional()
  @IsObjectId()
  owner?: string;
}
