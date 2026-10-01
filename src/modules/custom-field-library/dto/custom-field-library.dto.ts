import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { CustomFieldType } from '../../projects/schemas/custom-field.schema';

const hasOptions = (type: CustomFieldType | undefined) =>
  type === CustomFieldType.DROPDOWN || type === CustomFieldType.MULTI_SELECT;

export class CreateCustomFieldLibraryEntryDto {
  @ApiProperty({ example: 'Customer' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @ApiProperty({ enum: CustomFieldType })
  @IsEnum(CustomFieldType)
  type!: CustomFieldType;

  @ApiPropertyOptional({
    type: [String],
    description: 'Required, non-empty, only for Dropdown/MultiSelect',
  })
  @ValidateIf((dto: CreateCustomFieldLibraryEntryDto) => hasOptions(dto.type))
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  options?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

/** `type` is deliberately absent - a field's type is fixed for life, same as a project field. */
export class UpdateCustomFieldLibraryEntryDto extends PartialType(
  OmitType(CreateCustomFieldLibraryEntryDto, ['type', 'options'] as const),
) {
  @ApiPropertyOptional({ type: [String], description: 'Dropdown/MultiSelect entries only' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  options?: string[];
}

export class AdoptLibraryFieldDto {
  @ApiPropertyOptional({
    description: 'Whether the field is required in this project (default false)',
  })
  @IsOptional()
  @IsBoolean()
  required?: boolean;
}
