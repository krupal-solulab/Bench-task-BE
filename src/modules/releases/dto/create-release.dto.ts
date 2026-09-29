import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

export class CreateReleaseDto {
  @ApiProperty({ example: 'v2.4.0' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ description: 'Target ship date', nullable: true })
  @IsOptional()
  @IsISO8601()
  releaseDate?: string | null;

  @ApiPropertyOptional({
    description: 'The person responsible for shipping this release',
    nullable: true,
  })
  @IsOptional()
  @IsObjectId()
  ownerId?: string | null;
}
