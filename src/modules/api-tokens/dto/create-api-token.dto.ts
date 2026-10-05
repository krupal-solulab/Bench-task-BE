import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

export const API_TOKEN_EXPIRY_DAYS = [30, 90, 365] as const;

/** Module 11 gap-closure: create a personal API token. */
export class CreateApiTokenDto {
  @ApiProperty({ example: 'CI pipeline' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @ApiPropertyOptional({
    enum: [...API_TOKEN_EXPIRY_DAYS, null],
    nullable: true,
    description: 'Days until it expires; null = never (default 90)',
  })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsIn(API_TOKEN_EXPIRY_DAYS)
  expiresInDays?: (typeof API_TOKEN_EXPIRY_DAYS)[number] | null;
}
