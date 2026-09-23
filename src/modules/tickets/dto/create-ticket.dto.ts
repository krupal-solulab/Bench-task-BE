import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { TicketPriority } from '../../../common/enums/ticket-priority.enum';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

export class CreateTicketDto {
  @ApiProperty({ example: 'Cannot reset my password' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subject!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  // Exactly one of customerId OR (customerEmail + customerName) must be given - validated in
  // TicketsService, mirroring CreateSprintDto's own service-layer cross-field validation
  // (durationWeeks vs endDate) rather than a bespoke class-validator XOR decorator.
  @ApiPropertyOptional({ description: 'An existing Customer contact id' })
  @IsOptional()
  @IsObjectId()
  customerId?: string;

  @ApiPropertyOptional({ description: 'Used with customerName to find-or-create a contact' })
  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  customerEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  customerName?: string;

  @ApiPropertyOptional({ enum: TicketPriority, default: TicketPriority.NORMAL })
  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsObjectId()
  assignee?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  tags?: string[];
}
