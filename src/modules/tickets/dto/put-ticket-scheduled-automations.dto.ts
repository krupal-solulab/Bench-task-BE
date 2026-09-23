import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { TicketStatus } from '../../../common/enums/ticket-status.enum';
import {
  TicketAutomationActionDto,
  TicketAutomationConditionDto,
} from './put-ticket-automation-rules.dto';

export class TicketScheduledAutomationDto {
  @ApiPropertyOptional({
    description: 'Omit when creating a new scheduled automation - the server assigns a stable id.',
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ example: 'Auto-close stale pending tickets' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ enum: TicketStatus, description: 'Which status the ticket must currently be in' })
  @IsEnum(TicketStatus)
  matchStatus!: TicketStatus;

  @ApiProperty({ example: 72, description: 'Hours the ticket must have been in matchStatus' })
  @IsInt()
  @Min(1)
  afterHours!: number;

  @ApiProperty({ type: [TicketAutomationConditionDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TicketAutomationConditionDto)
  conditions!: TicketAutomationConditionDto[];

  @ApiProperty({ type: [TicketAutomationActionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TicketAutomationActionDto)
  actions!: TicketAutomationActionDto[];
}

export class PutTicketScheduledAutomationsDto {
  @ApiProperty({ type: [TicketScheduledAutomationDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => TicketScheduledAutomationDto)
  automations!: TicketScheduledAutomationDto[];
}
