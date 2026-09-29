import { ApiProperty } from '@nestjs/swagger';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

export class MoveTaskProjectDto {
  @ApiProperty({ description: 'The destination project id' })
  @IsObjectId()
  targetProjectId!: string;
}
