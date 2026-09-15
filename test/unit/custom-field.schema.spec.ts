import { BadRequestException } from '@nestjs/common';
import {
  CustomFieldDefinition,
  CustomFieldType,
  validateCustomFieldValues,
} from 'src/modules/projects/schemas/custom-field.schema';

const TEXT_FIELD: CustomFieldDefinition = {
  id: 'f-text',
  name: 'Steps to Reproduce',
  type: CustomFieldType.TEXT,
  required: false,
  options: null,
};
const NUMBER_FIELD: CustomFieldDefinition = {
  id: 'f-number',
  name: 'Story Cost',
  type: CustomFieldType.NUMBER,
  required: false,
  options: null,
};
const DATE_FIELD: CustomFieldDefinition = {
  id: 'f-date',
  name: 'Target Release',
  type: CustomFieldType.DATE,
  required: false,
  options: null,
};
const DROPDOWN_FIELD: CustomFieldDefinition = {
  id: 'f-dropdown',
  name: 'Severity',
  type: CustomFieldType.DROPDOWN,
  required: false,
  options: ['Low', 'Medium', 'High'],
};
const CHECKBOX_FIELD: CustomFieldDefinition = {
  id: 'f-checkbox',
  name: 'Needs QA',
  type: CustomFieldType.CHECKBOX,
  required: false,
  options: null,
};
const REQUIRED_TEXT_FIELD: CustomFieldDefinition = {
  id: 'f-required',
  name: 'Root Cause',
  type: CustomFieldType.TEXT,
  required: true,
  options: null,
};

const ALL_FIELDS = [TEXT_FIELD, NUMBER_FIELD, DATE_FIELD, DROPDOWN_FIELD, CHECKBOX_FIELD];

describe('validateCustomFieldValues', () => {
  it('accepts an empty value map when nothing is required', () => {
    expect(() => validateCustomFieldValues(ALL_FIELDS, {}, 'create')).not.toThrow();
  });

  it('rejects a value for a field id that does not exist on the project', () => {
    expect(() => validateCustomFieldValues(ALL_FIELDS, { 'unknown-id': 'x' }, 'create')).toThrow(
      BadRequestException,
    );
  });

  describe('Text', () => {
    it('accepts a string', () => {
      expect(() =>
        validateCustomFieldValues(
          ALL_FIELDS,
          { [TEXT_FIELD.id]: 'reproduced on staging' },
          'create',
        ),
      ).not.toThrow();
    });

    it('rejects a non-string', () => {
      expect(() =>
        validateCustomFieldValues(ALL_FIELDS, { [TEXT_FIELD.id]: 123 }, 'create'),
      ).toThrow(BadRequestException);
    });
  });

  describe('Number', () => {
    it('accepts a number', () => {
      expect(() =>
        validateCustomFieldValues(ALL_FIELDS, { [NUMBER_FIELD.id]: 42 }, 'create'),
      ).not.toThrow();
    });

    it('rejects a non-number', () => {
      expect(() =>
        validateCustomFieldValues(ALL_FIELDS, { [NUMBER_FIELD.id]: '42' }, 'create'),
      ).toThrow(BadRequestException);
    });

    it('rejects NaN', () => {
      expect(() =>
        validateCustomFieldValues(ALL_FIELDS, { [NUMBER_FIELD.id]: NaN }, 'create'),
      ).toThrow(BadRequestException);
    });
  });

  describe('Date', () => {
    it('accepts a valid ISO date string', () => {
      expect(() =>
        validateCustomFieldValues(
          ALL_FIELDS,
          { [DATE_FIELD.id]: '2026-03-01T00:00:00.000Z' },
          'create',
        ),
      ).not.toThrow();
    });

    it('rejects an unparseable date string', () => {
      expect(() =>
        validateCustomFieldValues(ALL_FIELDS, { [DATE_FIELD.id]: 'not-a-date' }, 'create'),
      ).toThrow(BadRequestException);
    });
  });

  describe('Dropdown', () => {
    it('accepts a value from the configured options', () => {
      expect(() =>
        validateCustomFieldValues(ALL_FIELDS, { [DROPDOWN_FIELD.id]: 'High' }, 'create'),
      ).not.toThrow();
    });

    it('rejects a value not in the configured options', () => {
      expect(() =>
        validateCustomFieldValues(ALL_FIELDS, { [DROPDOWN_FIELD.id]: 'Critical' }, 'create'),
      ).toThrow(BadRequestException);
    });
  });

  describe('Checkbox', () => {
    it('accepts a boolean', () => {
      expect(() =>
        validateCustomFieldValues(ALL_FIELDS, { [CHECKBOX_FIELD.id]: true }, 'create'),
      ).not.toThrow();
    });

    it('rejects a non-boolean', () => {
      expect(() =>
        validateCustomFieldValues(ALL_FIELDS, { [CHECKBOX_FIELD.id]: 'true' }, 'create'),
      ).toThrow(BadRequestException);
    });
  });

  describe('required fields', () => {
    it('rejects a missing required field on create', () => {
      expect(() => validateCustomFieldValues([REQUIRED_TEXT_FIELD], {}, 'create')).toThrow(
        BadRequestException,
      );
    });

    it('rejects an empty-string value for a required field on create', () => {
      expect(() =>
        validateCustomFieldValues(
          [REQUIRED_TEXT_FIELD],
          { [REQUIRED_TEXT_FIELD.id]: '' },
          'create',
        ),
      ).toThrow(BadRequestException);
    });

    it('accepts a provided required field on create', () => {
      expect(() =>
        validateCustomFieldValues(
          [REQUIRED_TEXT_FIELD],
          { [REQUIRED_TEXT_FIELD.id]: 'disk full' },
          'create',
        ),
      ).not.toThrow();
    });

    it('does NOT require a required field to be re-supplied on update (partial-patch semantics)', () => {
      expect(() => validateCustomFieldValues([REQUIRED_TEXT_FIELD], {}, 'update')).not.toThrow();
    });

    it('still type-checks a required field if it IS provided on update', () => {
      expect(() =>
        validateCustomFieldValues(
          [REQUIRED_TEXT_FIELD],
          { [REQUIRED_TEXT_FIELD.id]: 42 },
          'update',
        ),
      ).toThrow(BadRequestException);
    });
  });
});
