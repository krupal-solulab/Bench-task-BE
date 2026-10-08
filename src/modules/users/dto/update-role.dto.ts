import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { OptionalCustomRoleId } from '../../../common/validators/optional-custom-role';
import { ORG_ROLES, OrgRole } from '../../../common/enums/role.enum';

export class UpdateRoleDto {
  @ApiProperty({ enum: ORG_ROLES })
  @IsIn(ORG_ROLES)
  role!: OrgRole;

  @OptionalCustomRoleId()
  customRoleId?: string | null;
}
