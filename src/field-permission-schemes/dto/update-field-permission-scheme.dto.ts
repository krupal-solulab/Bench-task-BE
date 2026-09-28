import { PartialType } from '@nestjs/swagger';
import { CreateFieldPermissionSchemeDto } from './create-field-permission-scheme.dto';

export class UpdateFieldPermissionSchemeDto extends PartialType(CreateFieldPermissionSchemeDto) {}
