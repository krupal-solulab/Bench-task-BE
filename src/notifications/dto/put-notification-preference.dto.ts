import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsIn } from 'class-validator';
import { NOTIFICATION_TYPES, NotificationType } from '../schemas/notification.schema';

export class PutNotificationPreferenceDto {
  @ApiProperty({ enum: NotificationType, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsIn(NOTIFICATION_TYPES, { each: true })
  mutedTypes!: NotificationType[];
}
