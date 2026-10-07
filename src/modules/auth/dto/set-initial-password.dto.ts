import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches, MinLength } from 'class-validator';

/** Completes an invite account: the invitee's own name and password. */
export class SetInitialPasswordDto {
  @ApiProperty({ example: 'Asha Patel' })
  @IsString()
  @Length(2, 60)
  name!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'newPassword must contain at least one letter and one number',
  })
  newPassword!: string;
}
