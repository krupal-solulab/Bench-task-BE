import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601 } from 'class-validator';

/** Module 11 gap-closure: snooze one issue's notifications until a future moment (max 90 days). */
export class PutNotificationSnoozeDto {
  @ApiProperty({ example: '2026-10-06T09:00:00.000Z' })
  @IsISO8601()
  until!: string;
}
