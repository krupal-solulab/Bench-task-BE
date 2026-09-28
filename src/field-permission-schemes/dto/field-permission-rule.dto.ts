import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsEnum, IsString, MaxLength } from 'class-validator';
import { Role } from '../../common/enums/role.enum';

export class FieldPermissionRuleDto {
  @ApiProperty({ example: 'priority', description: 'A built-in field id or a custom field id' })
  @IsString()
  @MaxLength(60)
  fieldId!: string;

  @ApiProperty({ enum: Role, isArray: true })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(Object.values(Role).length)
  @IsEnum(Role, { each: true })
  hiddenFromRoles!: Role[];

  @ApiProperty({ enum: Role, isArray: true })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(Object.values(Role).length)
  @IsEnum(Role, { each: true })
  readOnlyForRoles!: Role[];
}
