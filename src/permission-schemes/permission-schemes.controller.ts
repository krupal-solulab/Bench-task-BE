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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { Role } from '../common/enums/role.enum';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { PermissionSchemesService } from './permission-schemes.service';
import { CreatePermissionSchemeDto } from './dto/create-permission-scheme.dto';
import { UpdatePermissionSchemeDto } from './dto/update-permission-scheme.dto';

@ApiTags('permission-schemes')
@ApiBearerAuth()
@Controller('permission-schemes')
@Roles(Role.ADMIN)
export class PermissionSchemesController {
  constructor(private readonly permissionSchemesService: PermissionSchemesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a reusable permission scheme for this organization' })
  async create(@Body() dto: CreatePermissionSchemeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.permissionSchemesService.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: "List this organization's permission schemes" })
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.permissionSchemesService.listMine(user);
  }

  @Patch(':id')
  @ApiOperation({ summary: "Update a permission scheme's name and/or grants" })
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdatePermissionSchemeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.permissionSchemesService.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a permission scheme (must not be assigned to any project)' })
  async remove(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.permissionSchemesService.remove(id, user);
  }
}
