import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray } from 'class-validator';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

export class BulkMoveProjectDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsObjectId({ each: true })
  taskIds!: string[];

  @ApiProperty({ description: 'The destination project id' })
  @IsObjectId()
  targetProjectId!: string;
}
