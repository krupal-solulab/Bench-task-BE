import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { requireOrgId } from '../common/utils/auth-user.util';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { NotificationsService } from './notifications.service';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { PutNotificationPreferenceDto } from './dto/put-notification-preference.dto';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: "List the caller's own notifications, newest first" })
  async list(@Query() query: ListNotificationsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.listMine(user.id, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: "The caller's unread notification count" })
  async unreadCount(@CurrentUser() user: AuthenticatedUser) {
    const count = await this.notificationsService.unreadCount(user.id);
    return { count };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: "Mark one of the caller's own notifications as read" })
  async markRead(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.notificationsService.markRead(id, user.id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Mark every unread notification of the caller's as read" })
  async markAllRead(@CurrentUser() user: AuthenticatedUser) {
    await this.notificationsService.markAllRead(user.id);
  }

  @Get('preferences')
  @ApiOperation({ summary: "The caller's muted notification types (defaults if never set)" })
  async getPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.getPreferences(user.id);
  }

  @Put('preferences')
  @ApiOperation({ summary: "Save the caller's own muted notification types" })
  async updatePreferences(
    @Body() dto: PutNotificationPreferenceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notificationsService.updatePreferences(user.id, requireOrgId(user), dto);
  }
}
