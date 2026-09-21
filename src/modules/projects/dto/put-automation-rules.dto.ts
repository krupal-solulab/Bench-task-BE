import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  AutomationActionType,
  AutomationConditionField,
  AutomationTriggerType,
} from '../schemas/automation-rule.schema';

export class AutomationConditionDto {
  @ApiProperty({ enum: AutomationConditionField })
  @IsEnum(AutomationConditionField)
  field!: AutomationConditionField;

  @ApiProperty({ example: 'Bug' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  value!: string;
}

export class AutomationActionDto {
  @ApiProperty({ enum: AutomationActionType })
  @IsEnum(AutomationActionType)
  type!: AutomationActionType;

  @ApiProperty({
    example: 'Done',
    description:
      'Status name (SetStatus), priority (SetPriority), user id (SetAssignee), comma-separated ' +
      'labels (AddLabels), or comment text supporting {{title}}/{{issueKey}}/{{status}} (AddComment).',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  value!: string;
}

export class AutomationTriggerDto {
  @ApiProperty({ enum: AutomationTriggerType })
  @IsEnum(AutomationTriggerType)
  type!: AutomationTriggerType;

  @ApiPropertyOptional({ description: 'Required, only meaningful, for StatusChanged' })
  @ValidateIf((dto: AutomationTriggerDto) => dto.type === AutomationTriggerType.STATUS_CHANGED)
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  toStatus?: string;

  @ApiPropertyOptional({
    description:
      'Optional, only meaningful for StatusChanged - further scopes the trigger from "any ' +
      'status -> toStatus" to "fromStatus -> toStatus" (a specific workflow transition edge)',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  fromStatus?: string;

  @ApiPropertyOptional({
    description: 'Required, only meaningful, for UnassignedForDuration',
  })
  @ValidateIf(
    (dto: AutomationTriggerDto) => dto.type === AutomationTriggerType.UNASSIGNED_FOR_DURATION,
  )
  @IsInt()
  @Min(1)
  afterHours?: number;
}

export class AutomationRuleDto {
  @ApiPropertyOptional({
    description:
      'Omit when creating a new rule - the server assigns a stable id. Include the existing ' +
      "id when editing a rule's name/enabled/trigger/conditions/actions.",
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ example: 'Auto-assign new bugs' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ type: AutomationTriggerDto })
  @ValidateNested()
  @Type(() => AutomationTriggerDto)
  trigger!: AutomationTriggerDto;

  @ApiProperty({ type: [AutomationConditionDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AutomationConditionDto)
  conditions!: AutomationConditionDto[];

  @ApiProperty({ type: [AutomationActionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AutomationActionDto)
  actions!: AutomationActionDto[];
}

export class PutAutomationRulesDto {
  @ApiProperty({ type: [AutomationRuleDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AutomationRuleDto)
  rules!: AutomationRuleDto[];
}
