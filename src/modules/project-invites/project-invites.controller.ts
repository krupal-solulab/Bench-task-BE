import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ORG_ROLES } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { CreateProjectInviteDto } from './dto/create-project-invite.dto';
import { ProjectInvitesService } from './project-invites.service';

/** Invite people without an account to a project - same authority as adding members. */
@ApiTags('project-invites')
@ApiBearerAuth()
@Controller('projects/:id/invites')
// Any org role reaches these; the service lets through Admins, the owning Manager and members
// whose role has "Manage project" in this project.
@Roles(...ORG_ROLES)
export class ProjectInvitesController {
  constructor(private readonly invitesService: ProjectInvitesService) {}

  @Get()
  @ApiOperation({ summary: "List the project's invitations (newest first)" })
  async list(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.invitesService.list(id, user);
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Invite by email: generates a temporary password and a 7-day link (shown once)',
  })
  async create(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CreateProjectInviteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invitesService.create(id, dto, user);
  }

  @Post(':inviteId/resend')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'New link + temporary password, 7 more days (old ones stop working)' })
  async resend(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('inviteId', ParseObjectIdPipe) inviteId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invitesService.resend(id, inviteId, user);
  }

  @Delete(':inviteId')
  @ApiOperation({ summary: 'Revoke a pending invitation' })
  async revoke(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('inviteId', ParseObjectIdPipe) inviteId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invitesService.revoke(id, inviteId, user);
  }
}
