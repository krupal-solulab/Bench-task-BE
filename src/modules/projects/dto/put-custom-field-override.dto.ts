import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsOptional, IsString } from 'class-validator';

export class PutCustomFieldOverrideDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Custom field ids to hide entirely for this issue type',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  hiddenFieldIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Custom field ids to force required=true for this issue type',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  requiredFieldIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Custom field ids to force required=false for this issue type',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  optionalFieldIds?: string[];
}
