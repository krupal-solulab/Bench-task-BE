import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

export class PatchComponentLeadDto {
  @ApiProperty({ example: 'Frontend', description: "Must be one of the project's own components" })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;

  @ApiPropertyOptional({ description: 'Must be a member of this project. Omit/null to clear.' })
  @IsOptional()
  @IsObjectId()
  leadUserId?: string | null;
}
