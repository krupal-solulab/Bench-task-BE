import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListCustomersDto extends PaginationQueryDto {
  // Matches against email/name (case-insensitive substring) - see CustomersRepository.paginate.
  @ApiPropertyOptional({ description: 'Case-insensitive substring match on email or name' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
