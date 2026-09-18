import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsInt, Max, Min, ValidateNested } from 'class-validator';
import { TaskPriority } from '../../../common/enums/task-priority.enum';

export class SlaPolicyEntryDto {
  @ApiProperty({ enum: TaskPriority })
  @IsEnum(TaskPriority)
  priority!: TaskPriority;

  @ApiProperty({ example: 24, minimum: 1, maximum: 24 * 365 })
  @IsInt()
  @Min(1)
  @Max(24 * 365)
  resolutionHours!: number;
}

export class PutSlaPolicyDto {
  @ApiProperty({
    type: [SlaPolicyEntryDto],
    description: 'Empty resets the project to the system default policy',
  })
  @IsArray()
  @ArrayMaxSize(Object.values(TaskPriority).length)
  @ValidateNested({ each: true })
  @Type(() => SlaPolicyEntryDto)
  entries!: SlaPolicyEntryDto[];
}
