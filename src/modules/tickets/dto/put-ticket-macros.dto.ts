import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { TicketMacroVisibility } from '../schemas/ticket-macro.schema';
import { TicketAutomationActionDto } from './put-ticket-automation-rules.dto';

export class TicketMacroDto {
  @ApiPropertyOptional({
    description: 'Omit when creating a new macro - the server assigns a stable id.',
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ example: 'Close as resolved' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @ApiProperty({ type: [TicketAutomationActionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TicketAutomationActionDto)
  actions!: TicketAutomationActionDto[];

  @ApiProperty({ enum: TicketMacroVisibility })
  @IsEnum(TicketMacroVisibility)
  visibility!: TicketMacroVisibility;

  // Deliberately no `createdBy` field here - the server always derives/preserves ownership
  // (TicketsService.updateMacros keeps the stored createdBy for an edited macro, and stamps the
  // acting user for a new one) rather than trusting a client-supplied identity, which would let
  // one user create a macro that impersonates another as its owner.
}

export class PutTicketMacrosDto {
  @ApiProperty({ type: [TicketMacroDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => TicketMacroDto)
  macros!: TicketMacroDto[];
}
