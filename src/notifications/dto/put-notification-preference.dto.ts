import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsIn, IsOptional } from 'class-validator';
import { DIGEST_FREQUENCIES, DigestFrequency } from '../digest.util';
import { NOTIFICATION_TYPES, NotificationType } from '../schemas/notification.schema';

export class PutNotificationPreferenceDto {
  @ApiProperty({ enum: NotificationType, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsIn(NOTIFICATION_TYPES, { each: true })
  mutedTypes!: NotificationType[];

  @ApiPropertyOptional({ enum: DIGEST_FREQUENCIES, description: 'Module 11: digest frequency' })
  @IsOptional()
  @IsIn(DIGEST_FREQUENCIES)
  digest?: DigestFrequency;
}
