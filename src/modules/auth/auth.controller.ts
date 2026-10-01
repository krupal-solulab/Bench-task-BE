import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { SharedRoute } from '../../common/decorators/shared-route.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AllowDuringImpersonation } from '../../common/decorators/allow-during-impersonation.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { Role } from '../../common/enums/role.enum';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/schemas/audit-log-entry.schema';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { UsersService } from '../users/users.service';
import { CreateOrganizationDto } from '../organizations/dto/create-organization.dto';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateUserDto } from '../users/dto/update-user.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Public()
  @Post('register-organization')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a new organization and its first Admin (self-service)' })
  async registerOrganization(@Body() dto: CreateOrganizationDto) {
    return this.authService.registerOrganization(dto);
  }

  @Public()
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in with email + password' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token for a new access/refresh pair' })
  async refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @SharedRoute()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Revoke the current user's refresh tokens" })
  async logout(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.authService.logoutAllForUser(user.id);
  }

  @Post('logout-all')
  @SharedRoute()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke every refresh token for the current user' })
  async logoutAll(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.authService.logoutAllForUser(user.id);
  }

  @Get('me')
  @SharedRoute()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current authenticated user' })
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.findByIdOrThrow(user.id);
  }

  @Patch('me')
  @SharedRoute()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update own name/email (Module 11's self-service profile editing)" })
  async updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateUserDto) {
    return this.usersService.updateOwnProfile(user.id, dto);
  }

  @Patch('me/password')
  @SharedRoute()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change own password (revokes all sessions on success)' })
  async changePassword(
    @CurrentUser() authUser: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    const user = await this.usersService.findByIdOrThrow(authUser.id);
    await this.authService.changePassword(user, dto.currentPassword, dto.newPassword);
  }

  /**
   * Module 8 gap-closure: start a READ-ONLY "view as" session for a non-Admin user in the
   * caller's own org. Returns an access-only token; the client keeps the Admin's own session
   * aside and swaps back on exit. Audit-logged.
   */
  @Post('impersonate/:userId')
  @Roles(Role.ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Start a read-only "view as" session for a user (Admin only, Module 8)',
  })
  async impersonate(
    @Param('userId', ParseObjectIdPipe) userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const session = await this.authService.startImpersonation(user, userId);
    await this.auditLogService.record({
      organizationId: requireOrgId(user),
      actorId: user.id,
      action: AuditAction.IMPERSONATION_STARTED,
      targetType: 'User',
      targetId: session.user.id,
      targetLabel: session.user.name,
      metadata: { role: session.user.role, expiresInSeconds: session.expiresInSeconds },
    });
    return session;
  }

  /** Records the end of a "view as" session - the one non-read route allowed while viewing as. */
  @Post('impersonation/end')
  @AllowDuringImpersonation()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'End the current "view as" session (audit only, Module 8)' })
  async endImpersonation(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    if (!user.impersonatedBy) return;
    await this.auditLogService.record({
      organizationId: requireOrgId(user),
      actorId: user.impersonatedBy,
      action: AuditAction.IMPERSONATION_ENDED,
      targetType: 'User',
      targetId: user.id,
      targetLabel: user.email,
    });
  }
}
