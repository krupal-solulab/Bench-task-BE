import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn } from 'class-validator';
import { OptionalCustomRoleId } from '../../../common/validators/optional-custom-role';
import { PROJECT_MEMBER_ROLES, ProjectMemberRole, Role } from '../../../common/enums/role.enum';

/** No name: the invitee enters their own when they first sign in. */
export class CreateProjectInviteDto {
  @ApiProperty({ example: 'asha@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: PROJECT_MEMBER_ROLES, example: Role.DEVELOPER })
  @IsIn(PROJECT_MEMBER_ROLES)
  role!: ProjectMemberRole;

  @OptionalCustomRoleId()
  customRoleId?: string | null;
}
