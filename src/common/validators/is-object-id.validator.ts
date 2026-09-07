import { registerDecorator, ValidationOptions } from 'class-validator';
import { isValidObjectId } from 'mongoose';

export function IsObjectId(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isObjectId',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && isValidObjectId(value);
        },
        defaultMessage(): string {
          return `${propertyName} must be a valid id`;
        },
      },
    });
  };
}
