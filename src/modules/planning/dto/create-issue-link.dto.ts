import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

export class CreateIssueLinkDto {
  @ApiProperty({ description: 'The other task to link to' })
  @IsObjectId()
  targetTaskId!: string;

  @ApiProperty({ example: 'blocks', description: "One of the org's link-type ids" })
  @IsString()
  @MinLength(1)
  linkTypeId!: string;
}
