import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCommentDto {
  @ApiProperty({ example: 'Looks good, ready for review.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;
}
