import {
  BusinessHoursCalendar,
  calculateElapsedBusinessMs,
} from 'src/modules/tickets/schemas/business-hours-calendar.schema';

const HOUR_MS = 60 * 60 * 1000;

const CALENDAR: BusinessHoursCalendar = {
  workingDays: [1, 2, 3, 4, 5], // Mon-Fri
  workingHours: { start: '09:00', end: '18:00' },
  holidays: [],
};

describe('calculateElapsedBusinessMs', () => {
  it('returns 0 when to <= from', () => {
    const t = new Date('2026-01-05T10:00:00Z');
    expect(calculateElapsedBusinessMs(CALENDAR, 'UTC', t, t)).toBe(0);
    expect(calculateElapsedBusinessMs(CALENDAR, 'UTC', t, new Date(t.getTime() - 1000))).toBe(0);
  });

  it('returns the raw wall-clock elapsed time when calendar is null (24/7, no restriction)', () => {
    const from = new Date('2026-01-05T00:00:00Z');
    const to = new Date('2026-01-07T00:00:00Z');
    expect(calculateElapsedBusinessMs(null, 'UTC', from, to)).toBe(to.getTime() - from.getTime());
  });

  it('counts only the overlap with the working-hours window on a single working day', () => {
    // Monday 2026-01-05, 10:00 -> 14:00 UTC, entirely inside the 09:00-18:00 window.
    const from = new Date('2026-01-05T10:00:00Z');
    const to = new Date('2026-01-05T14:00:00Z');
    expect(calculateElapsedBusinessMs(CALENDAR, 'UTC', from, to)).toBe(4 * HOUR_MS);
  });

  it('excludes time before/after the working-hours window', () => {
    // Monday 20:00 -> Tuesday 10:00 UTC: only Tuesday 09:00-10:00 counts (1h).
    const from = new Date('2026-01-05T20:00:00Z');
    const to = new Date('2026-01-06T10:00:00Z');
    expect(calculateElapsedBusinessMs(CALENDAR, 'UTC', from, to)).toBe(1 * HOUR_MS);
  });

  it('excludes non-working days (weekend)', () => {
    // Friday 2026-01-02 17:00 -> Monday 2026-01-05 10:00 UTC:
    // Friday 17:00-18:00 (1h) + Sat/Sun skipped + Monday 09:00-10:00 (1h) = 2h.
    const from = new Date('2026-01-02T17:00:00Z');
    const to = new Date('2026-01-05T10:00:00Z');
    expect(calculateElapsedBusinessMs(CALENDAR, 'UTC', from, to)).toBe(2 * HOUR_MS);
  });

  it('excludes a configured holiday even though it falls on a working day', () => {
    // Monday 2026-01-05 is a holiday: Monday contributes 0h, Tuesday 09:00-10:00 contributes 1h.
    const calendar: BusinessHoursCalendar = { ...CALENDAR, holidays: ['2026-01-05'] };
    const from = new Date('2026-01-05T08:00:00Z');
    const to = new Date('2026-01-06T10:00:00Z');
    expect(calculateElapsedBusinessMs(calendar, 'UTC', from, to)).toBe(1 * HOUR_MS);
  });

  it('correctly measures full business days spanning a DST transition (America/New_York)', () => {
    // Fri 2026-03-06 09:00 EST (UTC-05:00) = 14:00Z ... Mon 2026-03-09 18:00 EDT (UTC-04:00) = 22:00Z.
    // Sat/Sun (incl. the Mar 8 spring-forward) are skipped as non-working days, so this should be
    // exactly two full 9h business days (Friday + Monday) regardless of the UTC-offset change.
    const from = new Date('2026-03-06T14:00:00Z');
    const to = new Date('2026-03-09T22:00:00Z');
    expect(calculateElapsedBusinessMs(CALENDAR, 'America/New_York', from, to)).toBe(18 * HOUR_MS);
  });
});
