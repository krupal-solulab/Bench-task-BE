import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';
import { SavedFilterScope } from '../schemas/saved-filter.schema';

export class ListSavedFiltersDto {
  @ApiPropertyOptional({ enum: SavedFilterScope })
  @IsOptional()
  @IsEnum(SavedFilterScope)
  scope?: SavedFilterScope;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObjectId()
  projectId?: string;
}
