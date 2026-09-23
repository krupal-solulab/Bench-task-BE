import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { CustomerTier } from '../../../common/enums/customer-tier.enum';
import { TicketPriority } from '../../../common/enums/ticket-priority.enum';
import { TicketChannel } from '../schemas/ticket.schema';

export class TicketSlaPolicyEntryDto {
  @ApiProperty({ enum: TicketPriority })
  @IsEnum(TicketPriority)
  priority!: TicketPriority;

  @ApiPropertyOptional({
    enum: CustomerTier,
    nullable: true,
    description: 'Omit/null to apply to every customer tier',
  })
  @IsOptional()
  @IsEnum(CustomerTier)
  customerTier?: CustomerTier | null;

  @ApiPropertyOptional({
    enum: TicketChannel,
    nullable: true,
    description: 'Omit/null to apply to every channel',
  })
  @IsOptional()
  @IsEnum(TicketChannel)
  channel?: TicketChannel | null;

  @ApiProperty({ example: 2, minimum: 1, maximum: 24 * 365 })
  @IsInt()
  @Min(1)
  @Max(24 * 365)
  firstResponseHours!: number;

  @ApiProperty({ example: 8, minimum: 1, maximum: 24 * 365 })
  @IsInt()
  @Min(1)
  @Max(24 * 365)
  resolutionHours!: number;

  @ApiProperty({
    type: [String],
    description:
      'Ordered backup-agent/team-lead user ids, notified in order on pre-breach escalation',
  })
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  escalationChain!: string[];
}

export class PutTicketSlaPolicyDto {
  @ApiProperty({ type: [TicketSlaPolicyEntryDto] })
  @IsArray()
  @ArrayMaxSize(50)
  policy!: TicketSlaPolicyEntryDto[];
}
