import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';
import { SavedFilterScope, SavedFilterVisibility } from '../schemas/saved-filter.schema';

export class CreateSavedFilterDto {
  @ApiProperty({ example: 'My open P1 bugs' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @ApiProperty({ enum: SavedFilterScope })
  @IsEnum(SavedFilterScope)
  scope!: SavedFilterScope;

  @ApiPropertyOptional({ description: 'Required when scope is "project"' })
  @IsOptional()
  @IsObjectId()
  projectId?: string;

  @ApiPropertyOptional({
    enum: SavedFilterVisibility,
    default: SavedFilterVisibility.PRIVATE,
    description:
      'SHARED is only valid when scope is "project" - visible to that project\'s members',
  })
  @IsOptional()
  @IsEnum(SavedFilterVisibility)
  visibility?: SavedFilterVisibility;

  @ApiProperty({ description: 'The task-list query this filter replays (minus `page`)' })
  @IsObject()
  query!: Record<string, unknown>;
}
