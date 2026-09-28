import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

export class PatchFieldPermissionSchemeDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'null to unassign (no field is view/edit-restricted on this project)',
  })
  @IsOptional()
  @IsObjectId()
  fieldPermissionSchemeId!: string | null;
}
