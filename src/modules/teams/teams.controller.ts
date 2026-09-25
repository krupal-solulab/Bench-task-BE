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
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ORG_ROLES, Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { TeamsService } from './teams.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';

@ApiTags('teams')
@ApiBearerAuth()
@Controller('teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Create a team (Module 6: Teams, Project Roles & Security Schemes)' })
  async create(@Body() dto: CreateTeamDto, @CurrentUser() user: AuthenticatedUser) {
    return this.teamsService.create(dto, user);
  }

  @Get()
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: "List this organization's teams" })
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.teamsService.listMine(user);
  }

  @Get(':id')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Get a single team' })
  async get(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.teamsService.getOwnedOrThrow(id, user);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: "Update a team's name, description, lead, and/or members" })
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateTeamDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teamsService.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a team' })
  async remove(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.teamsService.remove(id, user);
  }
}
