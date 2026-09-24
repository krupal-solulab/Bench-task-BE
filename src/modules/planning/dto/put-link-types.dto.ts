import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class LinkTypeDefinitionDto {
  @ApiPropertyOptional({
    description:
      'Omit when creating a new link type - the server assigns a stable id. Include the ' +
      "existing id when editing a type's name/inverseName/isBlocking.",
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ example: 'Blocks' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name!: string;

  @ApiProperty({ example: 'Is Blocked By' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  inverseName!: string;

  @ApiProperty({
    description: 'Whether this type participates in circular-dependency detection',
  })
  @IsBoolean()
  isBlocking!: boolean;
}

export class PutLinkTypesDto {
  @ApiProperty({ type: [LinkTypeDefinitionDto] })
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => LinkTypeDefinitionDto)
  linkTypes!: LinkTypeDefinitionDto[];
}
