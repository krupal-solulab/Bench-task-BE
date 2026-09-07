import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

export class UpdateTaskAssigneeDto {
  @ApiPropertyOptional({ nullable: true, description: 'null to unassign' })
  @IsOptional()
  @IsObjectId()
  assignee!: string | null;
}
