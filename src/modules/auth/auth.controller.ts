import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { SharedRoute } from '../../common/decorators/shared-route.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { UsersService } from '../users/users.service';
import { CreateOrganizationDto } from '../organizations/dto/create-organization.dto';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
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
}
