import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, MaxLength, MinLength } from 'class-validator';
import { CustomerTier } from '../../../common/enums/customer-tier.enum';

export class CreateCustomerDto {
  @ApiProperty({ example: 'dana@customer.com' })
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @ApiProperty({ example: 'Dana Customer' })
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ enum: CustomerTier, default: CustomerTier.STANDARD })
  @IsOptional()
  @IsEnum(CustomerTier)
  tier?: CustomerTier;
}
