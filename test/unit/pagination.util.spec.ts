import { BadRequestException } from '@nestjs/common';
import {
  assertWhitelistedSortBy,
  buildPaginationMeta,
  normalizePagination,
} from 'src/common/utils/pagination.util';

describe('pagination.util', () => {
  describe('normalizePagination', () => {
    it('defaults to page 1, limit 20 when nothing is passed', () => {
      expect(normalizePagination(undefined, undefined)).toEqual({ page: 1, limit: 20, skip: 0 });
    });

    it('uses the given page and limit when valid', () => {
      expect(normalizePagination(3, 10)).toEqual({ page: 3, limit: 10, skip: 20 });
    });

    it('clamps limit to the 100 max', () => {
      expect(normalizePagination(1, 500)).toEqual({ page: 1, limit: 100, skip: 0 });
    });

    it('falls back to page 1 for a zero or negative page', () => {
      expect(normalizePagination(0, 20).page).toBe(1);
      expect(normalizePagination(-5, 20).page).toBe(1);
    });

    it('falls back to limit 20 for a zero, negative, or non-integer limit', () => {
      expect(normalizePagination(1, 0).limit).toBe(20);
      expect(normalizePagination(1, -10).limit).toBe(20);
      expect(normalizePagination(1, 2.5).limit).toBe(20);
    });

    it('falls back to page 1 for a non-integer page', () => {
      expect(normalizePagination(1.5, 20).page).toBe(1);
    });

    it('computes skip correctly for later pages', () => {
      expect(normalizePagination(5, 20).skip).toBe(80);
    });
  });

  describe('buildPaginationMeta', () => {
    it('computes totalPages, hasNextPage, hasPrevPage for a middle page', () => {
      expect(buildPaginationMeta(137, 2, 20)).toEqual({
        total: 137,
        page: 2,
        limit: 20,
        totalPages: 7,
        hasNextPage: true,
        hasPrevPage: true,
      });
    });

    it('reports no previous page on page 1', () => {
      const meta = buildPaginationMeta(50, 1, 20);
      expect(meta.hasPrevPage).toBe(false);
      expect(meta.hasNextPage).toBe(true);
    });

    it('reports no next page on the last page', () => {
      const meta = buildPaginationMeta(50, 3, 20);
      expect(meta.totalPages).toBe(3);
      expect(meta.hasNextPage).toBe(false);
      expect(meta.hasPrevPage).toBe(true);
    });

    it('reports no next/prev page beyond the last page', () => {
      const meta = buildPaginationMeta(50, 10, 20);
      expect(meta.hasNextPage).toBe(false);
      expect(meta.hasPrevPage).toBe(true);
    });

    it('handles zero results', () => {
      expect(buildPaginationMeta(0, 1, 20)).toEqual({
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false,
      });
    });
  });

  describe('assertWhitelistedSortBy', () => {
    const whitelist = ['name', 'createdAt'] as const;

    it('returns the sortBy value when it is whitelisted', () => {
      expect(assertWhitelistedSortBy('name', whitelist)).toBe('name');
    });

    it('throws BadRequestException for a non-whitelisted value', () => {
      expect(() => assertWhitelistedSortBy('password', whitelist)).toThrow(BadRequestException);
    });

    it('rejects an empty string', () => {
      expect(() => assertWhitelistedSortBy('', whitelist)).toThrow(BadRequestException);
    });
  });
});
