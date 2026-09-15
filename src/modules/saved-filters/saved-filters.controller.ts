import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { SavedFiltersService } from './saved-filters.service';
import { CreateSavedFilterDto } from './dto/create-saved-filter.dto';
import { ListSavedFiltersDto } from './dto/list-saved-filters.dto';

@ApiTags('saved-filters')
@ApiBearerAuth()
@Controller('saved-filters')
export class SavedFiltersController {
  constructor(private readonly savedFiltersService: SavedFiltersService) {}

  @Post()
  @ApiOperation({ summary: "Save the caller's own current task-filter combination" })
  async create(@Body() dto: CreateSavedFilterDto, @CurrentUser() user: AuthenticatedUser) {
    return this.savedFiltersService.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: "List the caller's own saved filters" })
  async list(@Query() query: ListSavedFiltersDto, @CurrentUser() user: AuthenticatedUser) {
    return this.savedFiltersService.listMine(query, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete one of the caller's own saved filters" })
  async remove(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.savedFiltersService.remove(id, user);
  }
}
