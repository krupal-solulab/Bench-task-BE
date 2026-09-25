import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsOptional } from 'class-validator';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

/** Replaces (not merges) the given project role's userIds/teamIds - omit a field to leave it
 * unchanged, or send an empty array to clear it. */
export class SetRoleAssignmentDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsObjectId({ each: true })
  userIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(200)
  @IsObjectId({ each: true })
  teamIds?: string[];
}
