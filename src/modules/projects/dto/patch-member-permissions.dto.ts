import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class PatchMemberPermissionsDto {
  @ApiPropertyOptional({ description: 'Create tasks in this project' })
  @IsOptional()
  @IsBoolean()
  canCreateTask?: boolean;

  @ApiPropertyOptional({ description: 'Edit any task in this project, not just their own' })
  @IsOptional()
  @IsBoolean()
  canEditAnyTask?: boolean;

  @ApiPropertyOptional({ description: 'Delete any task in this project' })
  @IsOptional()
  @IsBoolean()
  canDeleteTask?: boolean;

  @ApiPropertyOptional({ description: "Transition any task's status, not just assigned tasks" })
  @IsOptional()
  @IsBoolean()
  canChangeAnyTaskStatus?: boolean;

  @ApiPropertyOptional({
    description: 'Create/edit/start/complete/delete sprints, move tasks in/out',
  })
  @IsOptional()
  @IsBoolean()
  canManageSprints?: boolean;
}
