import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn } from 'class-validator';
import { OptionalCustomRoleId } from '../../../common/validators/optional-custom-role';
import { ORG_ROLES, OrgRole, Role } from '../../../common/enums/role.enum';

/**
 * Admin > Users: invite someone to the organization (no project). Email + role only - the invitee
 * enters their own name and a temporary password is generated, exactly like a project invite.
 * Unlike a project invite, an Admin may invite another Admin (the old "New user" form allowed it).
 */
export class CreateOrganizationInviteDto {
  @ApiProperty({ example: 'asha@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: ORG_ROLES, example: Role.DEVELOPER })
  @IsIn(ORG_ROLES)
  role!: OrgRole;

  @OptionalCustomRoleId()
  customRoleId?: string | null;
}
