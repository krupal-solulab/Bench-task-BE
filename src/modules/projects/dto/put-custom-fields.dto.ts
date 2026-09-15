import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CustomFieldType } from '../schemas/custom-field.schema';

export class CustomFieldDefinitionDto {
  @ApiPropertyOptional({
    description:
      'Omit when creating a new field - the server assigns a stable id. Include the ' +
      "existing id when editing a field's name/required/options.",
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ example: 'Steps to Reproduce' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @ApiProperty({ enum: CustomFieldType })
  @IsEnum(CustomFieldType)
  type!: CustomFieldType;

  @ApiProperty()
  @IsBoolean()
  required!: boolean;

  @ApiPropertyOptional({ type: [String], description: 'Required, non-empty, only for Dropdown' })
  @ValidateIf((dto: CustomFieldDefinitionDto) => dto.type === CustomFieldType.DROPDOWN)
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  options?: string[];
}

export class PutCustomFieldsDto {
  @ApiProperty({ type: [CustomFieldDefinitionDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CustomFieldDefinitionDto)
  fields!: CustomFieldDefinitionDto[];
}
