import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsEnum } from 'class-validator';
import { Role } from '../../common/enums/role.enum';
import { IsObjectId } from '../../common/validators/is-object-id.validator';
import { SchemeAction } from '../schemas/permission-scheme.schema';

export class PermissionGrantDto {
  @ApiProperty({ enum: SchemeAction })
  @IsEnum(SchemeAction)
  action!: SchemeAction;

  @ApiProperty({ enum: Role, isArray: true })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(Object.values(Role).length)
  @IsEnum(Role, { each: true })
  allowedRoles!: Role[];

  @ApiProperty({ type: [String], description: 'User ids individually granted this action' })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(200)
  @IsObjectId({ each: true })
  allowedUserIds!: string[];
}
