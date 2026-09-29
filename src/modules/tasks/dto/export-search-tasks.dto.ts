import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ExportSearchTasksDto {
  @ApiProperty({ description: 'The same JQL-lite query GET /tasks/search accepts.' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  jql!: string;
}
