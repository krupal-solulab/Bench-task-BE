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
import { SecuritySchemesService } from './security-schemes.service';
import { CreateSecuritySchemeDto } from './dto/create-security-scheme.dto';
import { UpdateSecuritySchemeDto } from './dto/update-security-scheme.dto';

@ApiTags('security-schemes')
@ApiBearerAuth()
@Controller('security-schemes')
@Roles(Role.ADMIN)
export class SecuritySchemesController {
  constructor(private readonly securitySchemesService: SecuritySchemesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a reusable issue security scheme (Module 6)' })
  async create(@Body() dto: CreateSecuritySchemeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.securitySchemesService.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: "List this organization's security schemes" })
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.securitySchemesService.listMine(user);
  }

  @Patch(':id')
  @ApiOperation({ summary: "Update a security scheme's name and/or levels" })
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateSecuritySchemeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.securitySchemesService.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a security scheme (must not be assigned to any project)' })
  async remove(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.securitySchemesService.remove(id, user);
  }
}
