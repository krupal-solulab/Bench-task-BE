import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

export class UpdateTaskSprintDto {
  @ApiPropertyOptional({ nullable: true, description: 'null moves the task back to the backlog' })
  @IsOptional()
  @IsObjectId()
  sprintId!: string | null;
}
