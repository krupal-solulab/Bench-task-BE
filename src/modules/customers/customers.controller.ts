import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ORG_ROLES } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { ListCustomersDto } from './dto/list-customers.dto';

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Create a customer contact record (staff-filed, e.g. from an email)' })
  async create(@Body() dto: CreateCustomerDto, @CurrentUser() user: AuthenticatedUser) {
    return this.customersService.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'List customer contacts (org-scoped, search by email/name)' })
  async list(@Query() query: ListCustomersDto, @CurrentUser() user: AuthenticatedUser) {
    return this.customersService.paginate(query, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single customer contact' })
  async get(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.customersService.getActiveOrThrow(id, user);
  }
}
