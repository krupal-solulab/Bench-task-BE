import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PROJECT_MEMBER_ROLES, ProjectMemberRole } from '../../../common/enums/role.enum';
import { CUSTOM_ROLE_COLORS, CustomRoleColor } from '../schemas/custom-role.schema';

export class CustomRolePermissionsDto {
  @ApiProperty() @IsBoolean() canCreateTask!: boolean;
  @ApiProperty() @IsBoolean() canEditAnyTask!: boolean;
  @ApiProperty() @IsBoolean() canDeleteTask!: boolean;
  @ApiProperty() @IsBoolean() canChangeAnyTaskStatus!: boolean;
  @ApiProperty() @IsBoolean() canManageSprints!: boolean;
  @ApiProperty() @IsBoolean() canManageProject!: boolean;
}

export class CreateCustomRoleDto {
  @ApiProperty({ example: 'QA' })
  @IsString()
  @Length(2, 40)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiPropertyOptional({ enum: CUSTOM_ROLE_COLORS })
  @IsOptional()
  @IsIn(CUSTOM_ROLE_COLORS)
  color?: CustomRoleColor;

  @ApiProperty({ enum: PROJECT_MEMBER_ROLES, description: 'Access level the role builds on' })
  @IsIn(PROJECT_MEMBER_ROLES)
  accessLevel!: ProjectMemberRole;

  @ApiProperty({ type: CustomRolePermissionsDto })
  @ValidateNested()
  @Type(() => CustomRolePermissionsDto)
  permissions!: CustomRolePermissionsDto;
}

export class UpdateCustomRoleDto extends PartialType(CreateCustomRoleDto) {}
