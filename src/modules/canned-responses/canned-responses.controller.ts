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
import { ORG_ROLES } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { CannedResponsesService } from './canned-responses.service';
import { CreateCannedResponseDto } from './dto/create-canned-response.dto';
import { UpdateCannedResponseDto } from './dto/update-canned-response.dto';

@ApiTags('canned-responses')
@ApiBearerAuth()
@Roles(...ORG_ROLES)
@Controller('canned-responses')
export class CannedResponsesController {
  constructor(private readonly cannedResponsesService: CannedResponsesService) {}

  @Post()
  @ApiOperation({
    summary: "Create a canned response, shared with the caller's whole organization",
  })
  async create(@Body() dto: CreateCannedResponseDto, @CurrentUser() user: AuthenticatedUser) {
    return this.cannedResponsesService.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: "Every canned response in the caller's organization" })
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.cannedResponsesService.list(user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a canned response (any org member may edit any entry)' })
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateCannedResponseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cannedResponsesService.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a canned response (any org member may delete any entry)' })
  async remove(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.cannedResponsesService.remove(id, user);
  }
}
