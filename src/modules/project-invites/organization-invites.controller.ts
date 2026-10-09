import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { CreateOrganizationInviteDto } from './dto/create-organization-invite.dto';
import { ProjectInvitesService } from './project-invites.service';

/**
 * Admin > Users: invite people to the organization by email (no project) - the same invitation
 * flow as a project invite (7-day link, generated temporary password, the invitee completes their
 * own name and password), replacing the old form where the Admin typed a name and password.
 * Its own path (not users/invites) so it can never collide with GET users/:id.
 */
@ApiTags('organization-invites')
@ApiBearerAuth()
@Controller('organization-invites')
@Roles(Role.ADMIN)
export class OrganizationInvitesController {
  constructor(private readonly invitesService: ProjectInvitesService) {}

  @Get()
  @ApiOperation({ summary: "List the organization's invitations (newest first, Admin)" })
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.invitesService.listForOrganization(user);
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Invite by email: generates a temporary password and a 7-day link (shown once)',
  })
  async create(@Body() dto: CreateOrganizationInviteDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invitesService.createForOrganization(dto, user);
  }

  @Post(':inviteId/resend')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'New link + temporary password, 7 more days (old ones stop working)' })
  async resend(
    @Param('inviteId', ParseObjectIdPipe) inviteId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invitesService.resendForOrganization(inviteId, user);
  }

  @Delete(':inviteId')
  @ApiOperation({ summary: 'Revoke a pending invitation' })
  async revoke(
    @Param('inviteId', ParseObjectIdPipe) inviteId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invitesService.revokeForOrganization(inviteId, user);
  }
}
