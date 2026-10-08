import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { IsObjectId } from './is-object-id.validator';

/** An optional custom role id (QA, DevOps, ...); null/omitted = just the built-in role. */
export function OptionalCustomRoleId(): PropertyDecorator {
  return applyDecorators(
    ApiPropertyOptional({
      nullable: true,
      description: "A custom role id - the user's built-in role becomes its access level",
    }),
    IsOptional(),
    IsObjectId() as PropertyDecorator,
  );
}
