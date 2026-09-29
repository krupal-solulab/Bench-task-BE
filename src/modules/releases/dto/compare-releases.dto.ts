import { ApiProperty } from '@nestjs/swagger';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

export class CompareReleasesDto {
  @ApiProperty({ description: 'First release id to compare' })
  @IsObjectId()
  a!: string;

  @ApiProperty({ description: 'Second release id to compare' })
  @IsObjectId()
  b!: string;
}
