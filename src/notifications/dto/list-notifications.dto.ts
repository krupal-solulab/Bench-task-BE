import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { NotificationType } from '../schemas/notification.schema';

export class ListNotificationsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'true = only unread notifications' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  unreadOnly?: boolean;

  @ApiPropertyOptional({ enum: NotificationType, description: 'Module 11 - filter to one type' })
  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;
}
