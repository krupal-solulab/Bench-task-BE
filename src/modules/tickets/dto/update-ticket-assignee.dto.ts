import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

export class UpdateTicketAssigneeDto {
  @ApiPropertyOptional({ nullable: true, description: 'Null to unassign' })
  @IsOptional()
  @IsObjectId()
  assignee!: string | null;
}
