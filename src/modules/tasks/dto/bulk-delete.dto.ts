import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray } from 'class-validator';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

export class BulkDeleteDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsObjectId({ each: true })
  taskIds!: string[];
}
