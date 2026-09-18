import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCannedResponseDto {
  @ApiProperty({ example: 'Investigating' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  title!: string;

  @ApiProperty({ example: "Thanks for reporting this - we're looking into it now." })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;
}
