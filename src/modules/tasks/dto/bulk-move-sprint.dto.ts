import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional } from 'class-validator';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

export class BulkMoveSprintDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsObjectId({ each: true })
  taskIds!: string[];

  @ApiPropertyOptional({ nullable: true, description: 'null moves every task back to the backlog' })
  @IsOptional()
  @IsObjectId()
  sprintId!: string | null;
}
