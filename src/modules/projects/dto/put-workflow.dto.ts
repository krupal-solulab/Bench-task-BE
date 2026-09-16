import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { StatusCategory } from '../../../common/enums/status-category.enum';
import { Role } from '../../../common/enums/role.enum';

export class WorkflowStatusDto {
  @ApiProperty({ example: 'Blocked' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name!: string;

  @ApiProperty({ enum: StatusCategory })
  @IsEnum(StatusCategory)
  category!: StatusCategory;
}

export class WorkflowTransitionDto {
  @ApiProperty({ example: 'Todo' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  from!: string;

  @ApiProperty({ example: 'Blocked' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  to!: string;

  @ApiPropertyOptional({
    enum: Role,
    isArray: true,
    description: 'Condition: who may trigger this transition. Omit/empty for "anyone" (default).',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(Role, { each: true })
  allowedRoles?: Role[];

  @ApiPropertyOptional({
    description:
      'Validator: the task must already have a comment before this transition is allowed.',
  })
  @IsOptional()
  @IsBoolean()
  requireComment?: boolean;
}

export class PutWorkflowDto {
  @ApiProperty({ type: [WorkflowStatusDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => WorkflowStatusDto)
  statuses!: WorkflowStatusDto[];

  @ApiProperty({ type: [WorkflowTransitionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkflowTransitionDto)
  transitions!: WorkflowTransitionDto[];

  @ApiProperty({ example: 'Todo' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  initialStatus!: string;
}
