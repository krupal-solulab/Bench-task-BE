import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, ValidateIf, registerDecorator, ValidationOptions } from 'class-validator';
import { UpdateUserDto } from './update-user.dto';

/** A real IANA time zone the runtime recognizes (e.g. "Asia/Kolkata", "America/New_York"). */
export function isValidTimeZone(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 60) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function IsTimeZone(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isTimeZone',
      target: object.constructor,
      propertyName,
      options: { message: `${propertyName} must be a valid IANA time zone`, ...options },
      validator: { validate: isValidTimeZone },
    });
}

/**
 * Module 11 gap-closure: the self-service profile (`PATCH auth/me`) - the Admin user-edit DTO
 * plus the user's own display time zone. Kept separate so `PATCH users/:id` is unchanged.
 */
export class UpdateOwnProfileDto extends UpdateUserDto {
  @ApiPropertyOptional({
    nullable: true,
    example: 'Asia/Kolkata',
    description: 'IANA time zone for showing dates and times; null = use the browser default',
  })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsTimeZone()
  timezone?: string | null;
}
