import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDefined, IsString } from 'class-validator';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

export class BulkCustomFieldDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsObjectId({ each: true })
  taskIds!: string[];

  @ApiProperty({ description: "The project's CustomFieldDefinition.id to set" })
  @IsString()
  fieldId!: string;

  // Deliberately untyped/unvalidated here - a custom field's legal value shape (string, number,
  // date, single/multi-select, user id) depends entirely on that field's own definition, which
  // varies per project/issue-type. The existing validateCustomFieldValues() (reused via update(),
  // per task) is the real type check, exactly like a single-task custom-field edit already is.
  // No type-shape decorator (e.g. @IsString()) - deliberately, see above - but @IsDefined() still
  // has to be here: the global ValidationPipe's whitelist/forbidNonWhitelisted strips or rejects
  // any DTO property with zero validator decorators, which would silently drop this field entirely.
  @ApiProperty({ description: "The value to set - shape depends on the field's own type" })
  @IsDefined()
  value!: unknown;
}
