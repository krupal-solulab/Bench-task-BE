import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ImportTasksDto {
  @ApiProperty({
    description:
      'Raw CSV content - first row is headers (title, description, issueType, ' +
      'priority, dueDate, storyPoints, labels, components)',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(500_000)
  csv!: string;
}
