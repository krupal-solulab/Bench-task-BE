import { BadRequestException } from '@nestjs/common';
import { PaginationMetaDto } from '../dto/paginated-response.dto';

const MAX_LIMIT = 100;

export interface NormalizedPagination {
  page: number;
  limit: number;
  skip: number;
}

export function normalizePagination(page?: number, limit?: number): NormalizedPagination {
  const normalizedPage = Number.isInteger(page) && (page as number) >= 1 ? (page as number) : 1;
  const rawLimit = Number.isInteger(limit) && (limit as number) >= 1 ? (limit as number) : 20;
  const normalizedLimit = Math.min(rawLimit, MAX_LIMIT);

  return {
    page: normalizedPage,
    limit: normalizedLimit,
    skip: (normalizedPage - 1) * normalizedLimit,
  };
}

export function buildPaginationMeta(total: number, page: number, limit: number): PaginationMetaDto {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

  return {
    total,
    page,
    limit,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}

export function assertWhitelistedSortBy(sortBy: string, whitelist: readonly string[]): string {
  if (!whitelist.includes(sortBy)) {
    throw new BadRequestException(`sortBy must be one of: ${whitelist.join(', ')}`);
  }
  return sortBy;
}
