import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { OptionalCustomRoleId } from '../../../common/validators/optional-custom-role';
import { ORG_ROLES, OrgRole, Role } from '../../../common/enums/role.enum';

export class CreateUserDto {
  @ApiProperty({ example: 'Jane Doe' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @ApiProperty({ example: 'jane@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Password123' })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'password must contain at least one letter and one number',
  })
  password!: string;

  @ApiProperty({ enum: ORG_ROLES, example: Role.DEVELOPER })
  @IsIn(ORG_ROLES)
  role!: OrgRole;

  @OptionalCustomRoleId()
  customRoleId?: string | null;
}
