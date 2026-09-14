import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

export class UpdateTaskRankDto {
  @ApiPropertyOptional({ description: 'Omit to move to the top of the list' })
  @IsOptional()
  @IsObjectId()
  beforeTaskId?: string;

  @ApiPropertyOptional({ description: 'Omit to move to the bottom of the list' })
  @IsOptional()
  @IsObjectId()
  afterTaskId?: string;
}
