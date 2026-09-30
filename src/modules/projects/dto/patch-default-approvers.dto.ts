import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsEnum, IsOptional } from 'class-validator';
import { Role } from '../../../common/enums/role.enum';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

/**
 * Replaces (not merges) the project's whole default-approver grant - same full-replace semantics
 * as PutComponentsDto/PutWorkflowDto. Omitting a field clears that grantee kind (an absent array
 * means "no grantees of this kind"), mirroring how the 4 fields are always-present arrays (never
 * undefined) on WorkflowTransition once saved.
 */
export class PatchDefaultApproversDto {
  @ApiPropertyOptional({ enum: Role, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(Role, { each: true })
  allowedRoles?: Role[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsObjectId({ each: true })
  allowedUserIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsObjectId({ each: true })
  allowedTeamIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsObjectId({ each: true })
  allowedProjectRoleIds?: string[];
}
