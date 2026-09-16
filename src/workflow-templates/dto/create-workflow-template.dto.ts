import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { PutWorkflowDto } from '../../modules/projects/dto/put-workflow.dto';

export class CreateWorkflowTemplateDto {
  @ApiProperty({ example: 'Bug Tracking' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @ApiPropertyOptional({ example: 'Todo -> In Progress -> Needs QA -> Done' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ type: PutWorkflowDto })
  @ValidateNested()
  @Type(() => PutWorkflowDto)
  workflow!: PutWorkflowDto;
}
