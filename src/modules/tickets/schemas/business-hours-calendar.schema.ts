import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
export class BusinessHoursWindow {
  // 24h "HH:mm" local time, e.g. "09:00" - stored as a string (not a Date) since it's a
  // wall-clock-of-day value with no calendar date attached.
  @Prop({ required: true, trim: true })
  start!: string;

  @Prop({ required: true, trim: true })
  end!: string;
}

export const BusinessHoursWindowSchema = SchemaFactory.createForClass(BusinessHoursWindow);

/**
 * BRD 3.4's Business Hours calendar - anchored to Organization.timezone. Embedded directly on
 * Organization (Organization.businessHoursCalendar), not a separate collection, matching the
 * Phase 3 plan's per-org-config pattern for TicketAutomationRule/TicketMacro/TicketSlaPolicy.
 * A null value on the parent means "24/7, no restriction" - the default for every org that
 * hasn't opted in, so nothing changes until one deliberately configures a calendar.
 */
@Schema({ _id: false })
export class BusinessHoursCalendar {
  // 0 = Sunday ... 6 = Saturday.
  @Prop({ type: [Number], default: [1, 2, 3, 4, 5] })
  workingDays!: number[];

  @Prop({ type: BusinessHoursWindowSchema, required: true })
  workingHours!: BusinessHoursWindow;

  // "YYYY-MM-DD" local calendar dates - date-only strings avoid the timezone ambiguity a Date
  // object would introduce for a value that has no time-of-day component.
  @Prop({ type: [String], default: [] })
  holidays!: string[];
}

export const BusinessHoursCalendarSchema = SchemaFactory.createForClass(BusinessHoursCalendar);

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** The local (`timeZone`) calendar date/time/weekday an absolute instant corresponds to, via the
 * built-in Intl API - no date/timezone library dependency needed for this codebase's one use. */
function localParts(date: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    // Intl emits "24" for local midnight with hour12:false; normalize to 0.
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  };
}

/**
 * The absolute instant corresponding to a given local wall-clock date/time in `timeZone` -
 * converges in at most a couple of iterations (real-world UTC-offset shifts, e.g. DST, are at
 * most a few hours), the same probe-and-correct technique timezone libraries use internally.
 * `day` may overflow past the month's length (e.g. requesting "day after the last day of the
 * month") - JS's own Date.UTC normalizes that automatically.
 */
function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const targetMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guessMs = targetMs;
  for (let i = 0; i < 3; i++) {
    const p = localParts(new Date(guessMs), timeZone);
    const gotMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0);
    const diff = gotMs - targetMs;
    if (diff === 0) break;
    guessMs -= diff;
  }
  return new Date(guessMs);
}

function parseHHmm(value: string): { hour: number; minute: number } {
  const [h, m] = value.split(':').map(Number);
  return { hour: h || 0, minute: m || 0 };
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Elapsed milliseconds between `from` and `to`, counting only time inside `calendar`'s working
 * days/hours (anchored to `timeZone`) and excluding holidays. A null `calendar` means "24/7, no
 * restriction" and returns the raw wall-clock elapsed time unchanged - the default for every org
 * that hasn't configured a calendar. Pure and side-effect-free (no Date.now()) so it's
 * exhaustively unit-testable with fixed instants.
 */
export function calculateElapsedBusinessMs(
  calendar: BusinessHoursCalendar | null,
  timeZone: string,
  from: Date,
  to: Date,
): number {
  if (to.getTime() <= from.getTime()) return 0;
  if (!calendar) return to.getTime() - from.getTime();

  const { hour: startHour, minute: startMinute } = parseHHmm(calendar.workingHours.start);
  const { hour: endHour, minute: endMinute } = parseHHmm(calendar.workingHours.end);

  let elapsed = 0;
  let cursor = from;
  // One iteration per local calendar day - bounded well above any realistic SLA span (~10 years).
  for (let guard = 0; guard < 3660 && cursor.getTime() < to.getTime(); guard++) {
    const local = localParts(cursor, timeZone);
    const nextDayStart = zonedTimeToUtc(local.year, local.month, local.day + 1, 0, 0, timeZone);

    const isWorkingDay = calendar.workingDays.includes(local.weekday);
    const isHoliday = calendar.holidays.includes(dateKey(local.year, local.month, local.day));

    if (isWorkingDay && !isHoliday) {
      const windowStart = zonedTimeToUtc(
        local.year,
        local.month,
        local.day,
        startHour,
        startMinute,
        timeZone,
      );
      const windowEnd = zonedTimeToUtc(
        local.year,
        local.month,
        local.day,
        endHour,
        endMinute,
        timeZone,
      );
      const dayCapEnd = nextDayStart.getTime() < to.getTime() ? nextDayStart : to;
      const segmentStart = cursor.getTime() > windowStart.getTime() ? cursor : windowStart;
      const segmentEnd = dayCapEnd.getTime() < windowEnd.getTime() ? dayCapEnd : windowEnd;
      if (segmentEnd.getTime() > segmentStart.getTime()) {
        elapsed += segmentEnd.getTime() - segmentStart.getTime();
      }
    }

    cursor =
      nextDayStart.getTime() > cursor.getTime()
        ? nextDayStart
        : new Date(cursor.getTime() + 86400000);
  }

  return elapsed;
}
