import { granteeMatchesGrant, type GrantLike } from 'src/common/utils/grant-matching.util';
import { Role } from 'src/common/enums/role.enum';

function grant(overrides: Partial<GrantLike> = {}): GrantLike {
  return {
    allowedRoles: [],
    allowedUserIds: [],
    allowedTeamIds: [],
    allowedProjectRoleIds: [],
    ...overrides,
  };
}

describe('granteeMatchesGrant', () => {
  it('matches by global role', () => {
    expect(
      granteeMatchesGrant(grant({ allowedRoles: [Role.MANAGER] }), {
        role: Role.MANAGER,
        userId: 'u-1',
        teamIds: [],
        projectRoleIds: [],
      }),
    ).toBe(true);
  });

  it('matches by individual user id', () => {
    expect(
      granteeMatchesGrant(grant({ allowedUserIds: ['u-1'] }), {
        role: Role.DEVELOPER,
        userId: 'u-1',
        teamIds: [],
        projectRoleIds: [],
      }),
    ).toBe(true);
  });

  it('matches by team membership', () => {
    expect(
      granteeMatchesGrant(grant({ allowedTeamIds: ['team-1'] }), {
        role: Role.DEVELOPER,
        userId: 'u-1',
        teamIds: ['team-1', 'team-2'],
        projectRoleIds: [],
      }),
    ).toBe(true);
  });

  it('matches by project role membership', () => {
    expect(
      granteeMatchesGrant(grant({ allowedProjectRoleIds: ['role-1'] }), {
        role: Role.DEVELOPER,
        userId: 'u-1',
        teamIds: [],
        projectRoleIds: ['role-1'],
      }),
    ).toBe(true);
  });

  it('does not match when none of the 4 grantee kinds overlap', () => {
    expect(
      granteeMatchesGrant(
        grant({
          allowedRoles: [Role.ADMIN],
          allowedUserIds: ['u-2'],
          allowedTeamIds: ['team-2'],
          allowedProjectRoleIds: ['role-2'],
        }),
        { role: Role.DEVELOPER, userId: 'u-1', teamIds: ['team-1'], projectRoleIds: ['role-1'] },
      ),
    ).toBe(false);
  });

  it('does not match an empty grant against any context', () => {
    expect(
      granteeMatchesGrant(grant(), {
        role: Role.ADMIN,
        userId: 'u-1',
        teamIds: ['team-1'],
        projectRoleIds: ['role-1'],
      }),
    ).toBe(false);
  });
});
