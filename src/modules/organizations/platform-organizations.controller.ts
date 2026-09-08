import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { PlatformOnly } from '../../common/decorators/platform-only.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { Role } from '../../common/enums/role.enum';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { UpdateOrganizationStatusDto } from './dto/update-organization-status.dto';
import { AddOrganizationAdminDto } from './dto/add-organization-admin.dto';
import { ListOrganizationsDto } from './dto/list-organizations.dto';

@ApiTags('platform')
@ApiBearerAuth()
@Roles(Role.PLATFORM_ADMIN)
@PlatformOnly()
@Controller('platform/organizations')
export class PlatformOrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  @ApiOperation({ summary: 'Create an organization and its first Admin (PlatformAdmin only)' })
  async create(@Body() dto: CreateOrganizationDto) {
    const { organization, admin } = await this.organizationsService.createWithAdmin(dto, null);
    return { organization, admin };
  }

  @Get()
  @ApiOperation({ summary: 'List organizations with user counts (PlatformAdmin only)' })
  async list(@Query() query: ListOrganizationsDto) {
    return this.organizationsService.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Organization detail including its admins (PlatformAdmin only)' })
  async detail(@Param('id', ParseObjectIdPipe) id: string) {
    return this.organizationsService.getDetail(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename an organization (PlatformAdmin only)' })
  async rename(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateOrganizationDto) {
    return this.organizationsService.rename(id, dto.name);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Suspend or reactivate an organization (PlatformAdmin only)' })
  async setStatus(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateOrganizationStatusDto,
  ) {
    return this.organizationsService.setStatus(id, dto.status);
  }

  @Post(':id/admins')
  @ApiOperation({ summary: 'Add another Admin to an organization (PlatformAdmin only)' })
  async addAdmin(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: AddOrganizationAdminDto) {
    return this.organizationsService.addAdmin(id, dto);
  }
}
