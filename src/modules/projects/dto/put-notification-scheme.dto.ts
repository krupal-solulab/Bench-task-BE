import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsEnum, ValidateNested } from 'class-validator';
import { ORG_ROLES, Role } from '../../../common/enums/role.enum';
import {
  NotificationChannel,
  NotificationSchemeEvent,
} from '../schemas/notification-scheme.schema';

export class NotificationSchemeRuleDto {
  @ApiProperty({ enum: NotificationSchemeEvent })
  @IsEnum(NotificationSchemeEvent)
  event!: NotificationSchemeEvent;

  @ApiProperty({ enum: ORG_ROLES, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsEnum(Role, { each: true })
  notifyRoles!: Role[];

  @ApiProperty({ enum: NotificationChannel, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsEnum(NotificationChannel, { each: true })
  channels!: NotificationChannel[];
}

export class PutNotificationSchemeDto {
  @ApiProperty({ type: [NotificationSchemeRuleDto] })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => NotificationSchemeRuleDto)
  rules!: NotificationSchemeRuleDto[];
}
