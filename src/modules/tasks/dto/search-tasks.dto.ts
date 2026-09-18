import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class SearchTasksDto extends PaginationQueryDto {
  @ApiProperty({
    example:
      'project = "665f..." AND status != Done AND assignee = currentUser() ORDER BY priority',
    description: 'A JQL-lite compound query - see jql.util.ts for the supported grammar.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  jql!: string;
}
