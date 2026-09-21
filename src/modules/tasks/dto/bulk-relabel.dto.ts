import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, MaxLength } from 'class-validator';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

export class BulkRelabelDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsObjectId({ each: true })
  taskIds!: string[];

  // Adds these labels to each task's existing labels (union, not a replace) - the same merge
  // semantics automation's own ADD_LABELS action already uses (see tasks.service.ts).
  @ApiProperty({ type: [String], description: 'Labels to add to every selected task' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  labels!: string[];
}
