import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role } from '../../common/enums/role.enum';
import { IsObjectId } from '../../common/validators/is-object-id.validator';

export class SecurityLevelDto {
  @ApiProperty({ example: 'Confidential' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ enum: Role, isArray: true })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(Object.values(Role).length)
  @IsEnum(Role, { each: true })
  allowedRoles!: Role[];

  @ApiProperty({ type: [String], description: 'User ids individually granted view access' })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(200)
  @IsObjectId({ each: true })
  allowedUserIds!: string[];

  @ApiPropertyOptional({ type: [String], description: 'Team ids granted view access (Module 6)' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(200)
  @IsObjectId({ each: true })
  allowedTeamIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Project Role ids granted view access (Module 6)',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(200)
  @IsObjectId({ each: true })
  allowedProjectRoleIds?: string[];
}
