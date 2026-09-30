import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

export class CreateTeamDto {
  @ApiProperty({ example: 'Backend Guild' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsObjectId()
  leadId?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsObjectId({ each: true })
  memberIds?: string[];

  @ApiPropertyOptional({
    description: "The team's typical per-sprint story-point capacity (Module 6 gap-closure)",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  capacityPoints?: number;
}
