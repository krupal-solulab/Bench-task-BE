import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateOrganizationDto {
  @ApiProperty({ example: 'Acme Inc' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  organizationName!: string;

  @ApiProperty({ example: 'Jane Doe' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  adminName!: string;

  @ApiProperty({ example: 'jane@example.com' })
  @IsEmail()
  adminEmail!: string;

  @ApiProperty({ example: 'Password123' })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'adminPassword must contain at least one letter and one number',
  })
  adminPassword!: string;
}
