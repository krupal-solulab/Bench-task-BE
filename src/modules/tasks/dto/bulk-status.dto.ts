import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, MinLength } from 'class-validator';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

export class BulkStatusDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsObjectId({ each: true })
  taskIds!: string[];

  // A free-form status name, validated per-task against that task's own project workflow (a
  // custom workflow's status names aren't known here) - each task's transition is checked and
  // reported independently, exactly like every other bulk-* endpoint's partial-success shape.
  @ApiProperty({ example: 'Done' })
  @IsString()
  @MinLength(1)
  status!: string;
}
