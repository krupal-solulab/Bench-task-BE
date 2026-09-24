import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum } from 'class-validator';
import { TaskPriority } from '../../../common/enums/task-priority.enum';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

export class BulkPriorityDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsObjectId({ each: true })
  taskIds!: string[];

  @ApiProperty({ enum: TaskPriority })
  @IsEnum(TaskPriority)
  priority!: TaskPriority;
}
