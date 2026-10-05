import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { DisallowApiToken } from '../../common/decorators/disallow-api-token.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ORG_ROLES, Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/schemas/audit-log-entry.schema';
import { ApiTokensService } from './api-tokens.service';
import { CreateApiTokenDto } from './dto/create-api-token.dto';

/** Module 11 gap-closure: personal API tokens. Never manageable *with* a token. */
@ApiTags('api-tokens')
@ApiBearerAuth()
@Roles(...ORG_ROLES)
@DisallowApiToken()
@Controller('api-tokens')
export class ApiTokensController {
  constructor(
    private readonly apiTokensService: ApiTokensService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'My active API tokens (Module 11)' })
  async listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.apiTokensService.listMine(user);
  }

  @Post()
  @ApiOperation({ summary: 'Create an API token - the secret is returned only this once' })
  async create(@Body() dto: CreateApiTokenDto, @CurrentUser() user: AuthenticatedUser) {
    const { token, apiToken } = await this.apiTokensService.create(dto, user);
    await this.auditLogService.record({
      organizationId: requireOrgId(user),
      actorId: user.id,
      action: AuditAction.API_TOKEN_CREATED,
      targetType: 'ApiToken',
      targetId: apiToken.id,
      targetLabel: apiToken.name,
      metadata: { prefix: apiToken.prefix, expiresAt: apiToken.expiresAt },
    });
    return { token, apiToken };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revoke one of my API tokens' })
  async revoke(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    const revoked = await this.apiTokensService.revoke(id, user);
    await this.recordRevoked(user, revoked.id, revoked.name, false);
    return revoked;
  }

  @Get('org')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Every active API token in this organization (Admin)' })
  async listOrg(@CurrentUser() user: AuthenticatedUser) {
    return this.apiTokensService.listOrg(user);
  }

  @Delete('org/:id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: "Revoke anyone's API token in this organization (Admin)" })
  async revokeAny(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const revoked = await this.apiTokensService.revoke(id, user, true);
    await this.recordRevoked(user, revoked.id, revoked.name, true);
    return revoked;
  }

  private recordRevoked(user: AuthenticatedUser, id: string, name: string, byAdmin: boolean) {
    return this.auditLogService.record({
      organizationId: requireOrgId(user),
      actorId: user.id,
      action: AuditAction.API_TOKEN_REVOKED,
      targetType: 'ApiToken',
      targetId: id,
      targetLabel: name,
      metadata: { byAdmin },
    });
  }
}
