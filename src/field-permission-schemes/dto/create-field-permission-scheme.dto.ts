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
import { FieldPermissionRuleDto } from './field-permission-rule.dto';

export class CreateFieldPermissionSchemeDto {
  @ApiProperty({ example: 'Support field restrictions' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ type: [FieldPermissionRuleDto] })
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => FieldPermissionRuleDto)
  rules!: FieldPermissionRuleDto[];
}
