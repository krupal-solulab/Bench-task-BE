import { BadRequestException } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import {
  NotificationChannel,
  NotificationSchemeEvent,
  NotificationSchemeRule,
  assertValidNotificationScheme,
  resolveNotificationSchemeRule,
} from 'src/modules/projects/schemas/notification-scheme.schema';

function makeRule(overrides: Partial<NotificationSchemeRule> = {}): NotificationSchemeRule {
  return {
    event: NotificationSchemeEvent.COMMENTED,
    notifyRoles: [Role.MANAGER],
    channels: [NotificationChannel.IN_APP],
    ...overrides,
  };
}

describe('assertValidNotificationScheme', () => {
  it('accepts an empty scheme (regression: every existing project has no scheme)', () => {
    expect(() => assertValidNotificationScheme([])).not.toThrow();
  });

  it('accepts a valid rule with roles and a channel', () => {
    expect(() => assertValidNotificationScheme([makeRule()])).not.toThrow();
  });

  it('rejects a rule naming an event outside the configurable catalog', () => {
    expect(() =>
      assertValidNotificationScheme([
        makeRule({ event: 'NotARealEvent' as NotificationSchemeEvent }),
      ]),
    ).toThrow(BadRequestException);
  });

  it('accepts SlaBreach (BRD 8 - a real SLA-tracking feature now exists to trigger it)', () => {
    expect(() =>
      assertValidNotificationScheme([makeRule({ event: NotificationSchemeEvent.SLA_BREACH })]),
    ).not.toThrow();
  });

  it('rejects a duplicate entry for the same event', () => {
    expect(() =>
      assertValidNotificationScheme([
        makeRule({ event: NotificationSchemeEvent.ASSIGNED }),
        makeRule({ event: NotificationSchemeEvent.ASSIGNED }),
      ]),
    ).toThrow(BadRequestException);
  });

  it('rejects a role that is not an org role', () => {
    expect(() =>
      assertValidNotificationScheme([makeRule({ notifyRoles: [Role.PLATFORM_ADMIN] })]),
    ).toThrow(BadRequestException);
  });

  it('rejects roles with zero channels selected', () => {
    expect(() =>
      assertValidNotificationScheme([makeRule({ notifyRoles: [Role.MANAGER], channels: [] })]),
    ).toThrow(BadRequestException);
  });

  it('allows zero roles with zero channels (an unconfigured/cleared event row)', () => {
    expect(() =>
      assertValidNotificationScheme([makeRule({ notifyRoles: [], channels: [] })]),
    ).not.toThrow();
  });
});

describe('resolveNotificationSchemeRule', () => {
  it('returns undefined when the project has no scheme at all (regression)', () => {
    expect(resolveNotificationSchemeRule({}, NotificationSchemeEvent.COMMENTED)).toBeUndefined();
  });

  it('returns undefined when no rule matches the event', () => {
    const project = { notificationScheme: [makeRule({ event: NotificationSchemeEvent.ASSIGNED })] };
    expect(
      resolveNotificationSchemeRule(project, NotificationSchemeEvent.COMMENTED),
    ).toBeUndefined();
  });

  it('returns undefined for a matching event with zero roles configured (a harmless no-op)', () => {
    const project = {
      notificationScheme: [makeRule({ event: NotificationSchemeEvent.COMMENTED, notifyRoles: [] })],
    };
    expect(
      resolveNotificationSchemeRule(project, NotificationSchemeEvent.COMMENTED),
    ).toBeUndefined();
  });

  it('returns the matching rule when configured with at least one role', () => {
    const rule = makeRule({ event: NotificationSchemeEvent.SPRINT_STARTED });
    const project = { notificationScheme: [rule] };
    expect(resolveNotificationSchemeRule(project, NotificationSchemeEvent.SPRINT_STARTED)).toEqual(
      rule,
    );
  });
});
