import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class AcceptProjectInviteDto {
  @ApiProperty({ description: 'The temporary password from the invitation' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  temporaryPassword!: string;
}
