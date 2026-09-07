import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray } from 'class-validator';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

export class AddMembersDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsObjectId({ each: true })
  @Type(() => String)
  userIds!: string[];
}
