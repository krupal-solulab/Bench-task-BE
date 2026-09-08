import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { ORG_ROLES, OrgRole } from '../../../common/enums/role.enum';

export class UpdateRoleDto {
  @ApiProperty({ enum: ORG_ROLES })
  @IsIn(ORG_ROLES)
  role!: OrgRole;
}
