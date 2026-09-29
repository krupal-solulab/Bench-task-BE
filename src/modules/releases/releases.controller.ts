import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ORG_ROLES } from '../../common/enums/role.enum';
import { ReleaseStatus } from '../../common/enums/release-status.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { ReleasesService } from './releases.service';
import { CreateReleaseDto } from './dto/create-release.dto';
import { UpdateReleaseDto } from './dto/update-release.dto';
import { ListReleasesDto } from './dto/list-releases.dto';
import { CompareReleasesDto } from './dto/compare-releases.dto';

@ApiTags('releases')
@ApiBearerAuth()
@Controller('projects/:projectId/releases')
export class ReleasesController {
  constructor(private readonly releasesService: ReleasesService) {}

  @Post()
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Create a release (Fix Version) under a project' })
  async create(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Body() dto: CreateReleaseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.releasesService.create(projectId, dto, user);
  }

  @Get()
  @ApiOperation({ summary: "List a project's releases" })
  async list(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Query() query: ListReleasesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.releasesService.paginate(projectId, query, user);
  }

  // Declared before ":releaseId" - the same shape (one path segment after /releases), so it must
  // be registered first or Nest would try to parse "compare" itself as a releaseId ObjectId.
  @Get('compare')
  @ApiOperation({
    summary: "Scope-diff two of a project's releases (issues only in A, only in B, or in both)",
  })
  async compare(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Query() query: CompareReleasesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.releasesService.compare(projectId, query.a, query.b, user);
  }

  @Get(':releaseId')
  @ApiOperation({ summary: 'Get a single release' })
  async findOne(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Param('releaseId', ParseObjectIdPipe) releaseId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.releasesService.findOneScoped(projectId, releaseId, user);
  }

  @Patch(':releaseId')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Update release name/description/target date/owner' })
  async update(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Param('releaseId', ParseObjectIdPipe) releaseId: string,
    @Body() dto: UpdateReleaseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.releasesService.update(projectId, releaseId, dto, user);
  }

  @Post(':releaseId/release')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Mark a release as Released (sets the actual release timestamp)' })
  async release(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Param('releaseId', ParseObjectIdPipe) releaseId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.releasesService.transition(projectId, releaseId, ReleaseStatus.RELEASED, user);
  }

  @Post(':releaseId/unrelease')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Revert a Released release back to Unreleased' })
  async unrelease(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Param('releaseId', ParseObjectIdPipe) releaseId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.releasesService.transition(projectId, releaseId, ReleaseStatus.UNRELEASED, user);
  }

  @Post(':releaseId/archive')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Archive a release' })
  async archive(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Param('releaseId', ParseObjectIdPipe) releaseId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.releasesService.transition(projectId, releaseId, ReleaseStatus.ARCHIVED, user);
  }

  @Post(':releaseId/unarchive')
  @Roles(...ORG_ROLES)
  @ApiOperation({
    summary:
      'Restore an archived release (back to Released if it had already shipped, else Unreleased)',
  })
  async unarchive(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Param('releaseId', ParseObjectIdPipe) releaseId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.releasesService.unarchive(projectId, releaseId, user);
  }

  @Delete(':releaseId')
  @Roles(...ORG_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a release (detaches it from every issue that referenced it)' })
  async remove(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Param('releaseId', ParseObjectIdPipe) releaseId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.releasesService.remove(projectId, releaseId, user);
  }

  @Get(':releaseId/progress')
  @ApiOperation({
    summary: 'Issue count/done-count/percentage for issues tagged with this release',
  })
  async progress(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Param('releaseId', ParseObjectIdPipe) releaseId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.releasesService.progress(projectId, releaseId, user);
  }

  @Get(':releaseId/release-notes')
  @ApiOperation({
    summary: "Auto-drafted release notes composed from this release's completed issues",
  })
  async releaseNotes(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Param('releaseId', ParseObjectIdPipe) releaseId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.releasesService.releaseNotes(projectId, releaseId, user);
  }
}
