import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

export class PatchSecuritySchemeDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'null to unassign (issues are then never view-restricted on this project)',
  })
  @IsOptional()
  @IsObjectId()
  securitySchemeId!: string | null;
}
