import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

export class PatchPermissionSchemeDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'null to unassign (fall back to default project permissions)',
  })
  @IsOptional()
  @IsObjectId()
  permissionSchemeId!: string | null;
}
