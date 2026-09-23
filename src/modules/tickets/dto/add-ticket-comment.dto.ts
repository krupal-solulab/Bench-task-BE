import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AddTicketCommentDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  body!: string;

  @ApiPropertyOptional({
    default: true,
    description: 'true = customer-visible reply, false = internal note',
  })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
