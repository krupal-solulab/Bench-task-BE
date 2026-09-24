import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { JQL_DYNAMIC_VALUE_FIELDS } from '../search/jql-autocomplete.util';

export class AutocompleteValuesQueryDto {
  @ApiProperty({ enum: JQL_DYNAMIC_VALUE_FIELDS })
  @IsIn(JQL_DYNAMIC_VALUE_FIELDS)
  field!: (typeof JQL_DYNAMIC_VALUE_FIELDS)[number];
}
