import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateTaskStatusDto {
  @ApiProperty({
    example: 'In Progress',
    description:
      "A status name from the task's project workflow (its custom workflow, or the system default). Legality is validated against that workflow, not a fixed enum.",
  })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  status!: string;
}
