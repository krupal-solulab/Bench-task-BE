import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

export class CompleteSprintDto {
  @ApiPropertyOptional({
    nullable: true,
    description:
      "Where incomplete issues go (BRD 6.3's PM's choice) - omit/null for the default " +
      '(the backlog); a Planned sprint id moves them there instead.',
  })
  @IsOptional()
  @IsObjectId()
  nextSprintId?: string | null;
}
