import { PartialType } from '@nestjs/swagger';
import { CreatePermissionSchemeDto } from './create-permission-scheme.dto';

export class UpdatePermissionSchemeDto extends PartialType(CreatePermissionSchemeDto) {}
