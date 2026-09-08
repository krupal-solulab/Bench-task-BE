import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class AddOrganizationAdminDto {
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
}
