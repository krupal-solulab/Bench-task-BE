import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  TicketAutomationActionType,
  TicketAutomationConditionField,
  TicketAutomationTriggerType,
} from '../schemas/ticket-automation-rule.schema';

export class TicketAutomationConditionDto {
  @ApiProperty({ enum: TicketAutomationConditionField })
  @IsEnum(TicketAutomationConditionField)
  field!: TicketAutomationConditionField;

  @ApiProperty({ example: 'Urgent' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  value!: string;
}

export class TicketAutomationActionDto {
  @ApiProperty({ enum: TicketAutomationActionType })
  @IsEnum(TicketAutomationActionType)
  type!: TicketAutomationActionType;

  @ApiProperty({
    example: 'Open',
    description:
      'Status name (SetStatus), priority (SetPriority), user id (SetAssignee), comma-separated ' +
      'tags (AddTags), comment text supporting {{subject}}/{{ticketKey}}/{{status}} (AddComment), ' +
      'a Role (NotifyRole), or a URL (Webhook - logged only, not dispatched).',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  value!: string;
}

export class TicketAutomationTriggerDto {
  @ApiProperty({ enum: TicketAutomationTriggerType })
  @IsEnum(TicketAutomationTriggerType)
  type!: TicketAutomationTriggerType;

  @ApiPropertyOptional({ description: 'Required, only meaningful, for TicketStatusChanged' })
  @ValidateIf(
    (dto: TicketAutomationTriggerDto) => dto.type === TicketAutomationTriggerType.STATUS_CHANGED,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  toStatus?: string;

  @ApiPropertyOptional({
    description:
      'Optional, only meaningful for TicketStatusChanged - further scopes the trigger from ' +
      '"any status -> toStatus" to a specific fromStatus -> toStatus transition.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  fromStatus?: string;
}

export class TicketAutomationRuleDto {
  @ApiPropertyOptional({
    description:
      'Omit when creating a new rule - the server assigns a stable id. Include the existing ' +
      "id when editing a rule's name/enabled/trigger/conditions/actions.",
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ example: 'Notify manager on urgent tickets' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ type: TicketAutomationTriggerDto })
  @ValidateNested()
  @Type(() => TicketAutomationTriggerDto)
  trigger!: TicketAutomationTriggerDto;

  @ApiProperty({ type: [TicketAutomationConditionDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TicketAutomationConditionDto)
  conditions!: TicketAutomationConditionDto[];

  @ApiProperty({ type: [TicketAutomationActionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TicketAutomationActionDto)
  actions!: TicketAutomationActionDto[];
}

export class PutTicketAutomationRulesDto {
  @ApiProperty({ type: [TicketAutomationRuleDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => TicketAutomationRuleDto)
  rules!: TicketAutomationRuleDto[];
}
