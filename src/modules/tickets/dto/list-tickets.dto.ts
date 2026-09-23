import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { TicketPriority } from '../../../common/enums/ticket-priority.enum';
import { TicketStatus } from '../../../common/enums/ticket-status.enum';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

const toArray = ({ value }: { value: unknown }) =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

export class ListTicketsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TicketStatus, isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsEnum(TicketStatus, { each: true })
  status?: TicketStatus[];

  @ApiPropertyOptional({ enum: TicketPriority, isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsEnum(TicketPriority, { each: true })
  priority?: TicketPriority[];

  @ApiPropertyOptional({ nullable: true, description: 'null to filter unassigned tickets' })
  @IsOptional()
  @IsObjectId()
  assignee?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObjectId()
  customer?: string;

  @ApiPropertyOptional({ description: 'Case-insensitive substring match on subject/ticketKey' })
  @IsOptional()
  @IsString()
  search?: string;
}
