import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { IssueLinksService } from './issue-links.service';
import { PutLinkTypesDto } from './dto/put-link-types.dto';

/** Module 1's "custom link-type editor" - org-wide (no `:id`, unlike project settings), since a
 * link's meaning must read the same across every project it might span. */
@ApiTags('link-types')
@ApiBearerAuth()
@Controller('link-types')
export class LinkTypesController {
  constructor(private readonly issueLinksService: IssueLinksService) {}

  @Get()
  @ApiOperation({ summary: "This org's issue-link type catalog" })
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.issueLinksService.getLinkTypes(user);
  }

  @Put()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: "Set/replace this org's issue-link type catalog" })
  async update(@Body() dto: PutLinkTypesDto, @CurrentUser() user: AuthenticatedUser) {
    return this.issueLinksService.updateLinkTypes(dto, user);
  }
}
