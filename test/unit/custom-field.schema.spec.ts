import { BadRequestException } from '@nestjs/common';
import {
  CustomFieldDefinition,
  CustomFieldOverrideByType,
  CustomFieldType,
  assertValidCustomFieldOverride,
  resolveCustomFields,
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
const MULTI_SELECT_FIELD: CustomFieldDefinition = {
  id: 'f-multi',
  name: 'Affected Platforms',
  type: CustomFieldType.MULTI_SELECT,
  required: false,
  options: ['Web', 'iOS', 'Android'],
};
const USER_PICKER_FIELD: CustomFieldDefinition = {
  id: 'f-user',
  name: 'Reviewer',
  type: CustomFieldType.USER_PICKER,
  required: false,
  options: null,
};

const ALL_FIELDS = [
  TEXT_FIELD,
  NUMBER_FIELD,
  DATE_FIELD,
  DROPDOWN_FIELD,
  CHECKBOX_FIELD,
  MULTI_SELECT_FIELD,
  USER_PICKER_FIELD,
];

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

  describe('MultiSelect', () => {
    it('accepts a list of configured options', () => {
      expect(() =>
        validateCustomFieldValues(
          ALL_FIELDS,
          { [MULTI_SELECT_FIELD.id]: ['Web', 'iOS'] },
          'create',
        ),
      ).not.toThrow();
    });

    it('accepts an empty list', () => {
      expect(() =>
        validateCustomFieldValues(ALL_FIELDS, { [MULTI_SELECT_FIELD.id]: [] }, 'create'),
      ).not.toThrow();
    });

    it('rejects a value not in the configured options', () => {
      expect(() =>
        validateCustomFieldValues(ALL_FIELDS, { [MULTI_SELECT_FIELD.id]: ['Windows'] }, 'create'),
      ).toThrow(BadRequestException);
    });

    it('rejects a non-array', () => {
      expect(() =>
        validateCustomFieldValues(ALL_FIELDS, { [MULTI_SELECT_FIELD.id]: 'Web' }, 'create'),
      ).toThrow(BadRequestException);
    });

    it('treats an empty list as empty for a required MultiSelect field on create', () => {
      const requiredMulti = { ...MULTI_SELECT_FIELD, required: true };
      expect(() =>
        validateCustomFieldValues([requiredMulti], { [requiredMulti.id]: [] }, 'create'),
      ).toThrow(BadRequestException);
    });
  });

  describe('UserPicker', () => {
    it('accepts a string user id', () => {
      expect(() =>
        validateCustomFieldValues(ALL_FIELDS, { [USER_PICKER_FIELD.id]: 'user-123' }, 'create'),
      ).not.toThrow();
    });

    it('rejects a non-string', () => {
      expect(() =>
        validateCustomFieldValues(ALL_FIELDS, { [USER_PICKER_FIELD.id]: 123 }, 'create'),
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

describe('resolveCustomFields', () => {
  const PROJECT_FIELDS = [TEXT_FIELD, REQUIRED_TEXT_FIELD, DROPDOWN_FIELD];

  it('returns customFields untouched when issueType is omitted', () => {
    const project = { customFields: PROJECT_FIELDS, customFieldOverridesByType: [] };
    expect(resolveCustomFields(project)).toBe(PROJECT_FIELDS);
  });

  it('returns customFields untouched when no override exists for the given issueType', () => {
    const project = { customFields: PROJECT_FIELDS, customFieldOverridesByType: [] };
    expect(resolveCustomFields(project, 'Bug')).toBe(PROJECT_FIELDS);
  });

  it('drops hidden fields for the configured issueType', () => {
    const override: CustomFieldOverrideByType = {
      issueType: 'Bug',
      hiddenFieldIds: [DROPDOWN_FIELD.id],
      requiredFieldIds: [],
      optionalFieldIds: [],
    };
    const project = { customFields: PROJECT_FIELDS, customFieldOverridesByType: [override] };
    const resolved = resolveCustomFields(project, 'Bug');
    expect(resolved.map((f) => f.id)).toEqual([TEXT_FIELD.id, REQUIRED_TEXT_FIELD.id]);
  });

  it('does not affect other issue types', () => {
    const override: CustomFieldOverrideByType = {
      issueType: 'Bug',
      hiddenFieldIds: [DROPDOWN_FIELD.id],
      requiredFieldIds: [],
      optionalFieldIds: [],
    };
    const project = { customFields: PROJECT_FIELDS, customFieldOverridesByType: [override] };
    expect(resolveCustomFields(project, 'Story')).toBe(PROJECT_FIELDS);
  });

  it('forces a field required=true via requiredFieldIds', () => {
    const override: CustomFieldOverrideByType = {
      issueType: 'Bug',
      hiddenFieldIds: [],
      requiredFieldIds: [TEXT_FIELD.id],
      optionalFieldIds: [],
    };
    const project = { customFields: PROJECT_FIELDS, customFieldOverridesByType: [override] };
    const resolved = resolveCustomFields(project, 'Bug');
    expect(resolved.find((f) => f.id === TEXT_FIELD.id)?.required).toBe(true);
  });

  it('forces a field required=false via optionalFieldIds', () => {
    const override: CustomFieldOverrideByType = {
      issueType: 'Bug',
      hiddenFieldIds: [],
      requiredFieldIds: [],
      optionalFieldIds: [REQUIRED_TEXT_FIELD.id],
    };
    const project = { customFields: PROJECT_FIELDS, customFieldOverridesByType: [override] };
    const resolved = resolveCustomFields(project, 'Bug');
    expect(resolved.find((f) => f.id === REQUIRED_TEXT_FIELD.id)?.required).toBe(false);
  });

  it('hidden takes precedence over a required/optional override for the same field', () => {
    const override: CustomFieldOverrideByType = {
      issueType: 'Bug',
      hiddenFieldIds: [TEXT_FIELD.id],
      requiredFieldIds: [TEXT_FIELD.id],
      optionalFieldIds: [],
    };
    const project = { customFields: PROJECT_FIELDS, customFieldOverridesByType: [override] };
    const resolved = resolveCustomFields(project, 'Bug');
    expect(resolved.find((f) => f.id === TEXT_FIELD.id)).toBeUndefined();
  });
});

describe('assertValidCustomFieldOverride', () => {
  const FIELDS = [TEXT_FIELD, DROPDOWN_FIELD];

  it('accepts an override referencing only known field ids', () => {
    expect(() =>
      assertValidCustomFieldOverride(FIELDS, {
        hiddenFieldIds: [TEXT_FIELD.id],
        requiredFieldIds: [DROPDOWN_FIELD.id],
        optionalFieldIds: [],
      }),
    ).not.toThrow();
  });

  it('rejects an unknown field id', () => {
    expect(() =>
      assertValidCustomFieldOverride(FIELDS, {
        hiddenFieldIds: ['not-a-real-field'],
        requiredFieldIds: [],
        optionalFieldIds: [],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects a field id in both requiredFieldIds and optionalFieldIds', () => {
    expect(() =>
      assertValidCustomFieldOverride(FIELDS, {
        hiddenFieldIds: [],
        requiredFieldIds: [TEXT_FIELD.id],
        optionalFieldIds: [TEXT_FIELD.id],
      }),
    ).toThrow(BadRequestException);
  });
});
