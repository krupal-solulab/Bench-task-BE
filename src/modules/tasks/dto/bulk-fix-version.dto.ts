import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray } from 'class-validator';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

export class BulkFixVersionDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsObjectId({ each: true })
  taskIds!: string[];

  // Adds these releases to each task's existing fixVersions (union, not a replace) - same merge
  // semantics as BulkRelabelDto's labels.
  @ApiProperty({
    type: [String],
    description: 'Fix Version (release) ids to add to every selected task',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsObjectId({ each: true })
  fixVersions!: string[];
}
