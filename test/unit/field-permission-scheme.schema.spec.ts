import { Role } from 'src/common/enums/role.enum';
import {
  FieldPermissionScheme,
  canEditField,
  canViewField,
} from 'src/field-permission-schemes/schemas/field-permission-scheme.schema';

function makeScheme(
  rules: FieldPermissionScheme['rules'] = [],
): Pick<FieldPermissionScheme, 'rules'> {
  return { rules };
}

describe('field-permission-scheme.schema', () => {
  describe('canViewField / canEditField', () => {
    it('a null scheme (no scheme assigned) never restricts anything (regression)', () => {
      expect(canViewField(null, 'priority', Role.DEVELOPER)).toBe(true);
      expect(canEditField(null, 'priority', Role.DEVELOPER)).toBe(true);
    });

    it('a field with no rule in the scheme is fully open (only ever narrows)', () => {
      const scheme = makeScheme([
        { fieldId: 'priority', hiddenFromRoles: [Role.DEVELOPER], readOnlyForRoles: [] },
      ]);
      expect(canViewField(scheme, 'dueDate', Role.DEVELOPER)).toBe(true);
      expect(canEditField(scheme, 'dueDate', Role.DEVELOPER)).toBe(true);
    });

    it('hiddenFromRoles blocks both view and edit for that role', () => {
      const scheme = makeScheme([
        { fieldId: 'priority', hiddenFromRoles: [Role.DEVELOPER], readOnlyForRoles: [] },
      ]);
      expect(canViewField(scheme, 'priority', Role.DEVELOPER)).toBe(false);
      expect(canEditField(scheme, 'priority', Role.DEVELOPER)).toBe(false);
    });

    it('hiddenFromRoles does not affect a role not listed', () => {
      const scheme = makeScheme([
        { fieldId: 'priority', hiddenFromRoles: [Role.DEVELOPER], readOnlyForRoles: [] },
      ]);
      expect(canViewField(scheme, 'priority', Role.MANAGER)).toBe(true);
      expect(canEditField(scheme, 'priority', Role.MANAGER)).toBe(true);
    });

    it('readOnlyForRoles allows viewing but blocks editing', () => {
      const scheme = makeScheme([
        { fieldId: 'securityLevel', hiddenFromRoles: [], readOnlyForRoles: [Role.DEVELOPER] },
      ]);
      expect(canViewField(scheme, 'securityLevel', Role.DEVELOPER)).toBe(true);
      expect(canEditField(scheme, 'securityLevel', Role.DEVELOPER)).toBe(false);
    });

    it('a role in both hiddenFromRoles and readOnlyForRoles is still correctly blocked from editing', () => {
      const scheme = makeScheme([
        {
          fieldId: 'priority',
          hiddenFromRoles: [Role.DEVELOPER],
          readOnlyForRoles: [Role.DEVELOPER],
        },
      ]);
      expect(canEditField(scheme, 'priority', Role.DEVELOPER)).toBe(false);
    });

    it('custom field ids (not just built-ins) work identically - fieldId is just a string key', () => {
      const scheme = makeScheme([
        { fieldId: 'cf_customer_contact', hiddenFromRoles: [Role.DEVELOPER], readOnlyForRoles: [] },
      ]);
      expect(canViewField(scheme, 'cf_customer_contact', Role.DEVELOPER)).toBe(false);
      expect(canViewField(scheme, 'cf_customer_contact', Role.ADMIN)).toBe(true);
    });
  });
});
