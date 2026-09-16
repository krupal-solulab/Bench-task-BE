import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PermissionGrantDto } from './permission-grant.dto';

export class CreatePermissionSchemeDto {
  @ApiProperty({ example: 'Strict (QA cannot delete)' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ type: [PermissionGrantDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PermissionGrantDto)
  grants!: PermissionGrantDto[];
}
