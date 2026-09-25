import { PartialType } from '@nestjs/swagger';
import { CreateProjectRoleDto } from './create-project-role.dto';

export class UpdateProjectRoleDto extends PartialType(CreateProjectRoleDto) {}
