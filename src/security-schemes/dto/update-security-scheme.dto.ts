import { PartialType } from '@nestjs/swagger';
import { CreateSecuritySchemeDto } from './create-security-scheme.dto';

export class UpdateSecuritySchemeDto extends PartialType(CreateSecuritySchemeDto) {}
