import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { TicketPriority } from '../../../common/enums/ticket-priority.enum';

export class UpdateTicketPriorityDto {
  @ApiProperty({ enum: TicketPriority })
  @IsEnum(TicketPriority)
  priority!: TicketPriority;
}
