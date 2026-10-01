const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back completed issues count toward the throughput rate an ETA is projected from. */
export const ETA_THROUGHPUT_WINDOW_DAYS = 28;

export interface ReleaseEtaInput {
  totalIssues: number;
  doneIssues: number;
  /** This release's own issues completed inside the throughput window. */
  releaseDoneInWindow: number;
  /** The whole project's issues completed inside the window - the fallback rate for a release
   * that hasn't completed anything recently (e.g. a release that only just started). */
  projectDoneInWindow: number;
  releaseDate: Date | null;
  now: Date;
}

export interface ReleaseEta {
  remainingIssues: number;
  /** Issues completed per week that the projection is based on; null when there's no history. */
  throughputPerWeek: number | null;
  /** Which rate was used - the release's own, or the project-wide fallback. */
  basis: 'release' | 'project' | null;
  /** Projected completion date; `now` when nothing remains; null when it can't be projected. */
  projectedDate: Date | null;
  /** Whether the projection lands on/before the target `releaseDate`; null without one of them. */
  onTrack: boolean | null;
  daysLate: number | null;
}

/**
 * Module 9 gap-closure: a release ETA projection - remaining issues divided by recent throughput
 * (issues done per day over the last ETA_THROUGHPUT_WINDOW_DAYS). Deliberately a simple linear
 * forecast (no story-point weighting, no confidence interval), labeled as a projection in the UI;
 * the release's own recent rate is preferred, falling back to the project's when the release has
 * none yet.
 */
export function projectReleaseEta(input: ReleaseEtaInput): ReleaseEta {
  const remainingIssues = Math.max(0, input.totalIssues - input.doneIssues);
  const releaseDate = input.releaseDate;

  const verdict = (projectedDate: Date | null) => {
    if (!projectedDate || !releaseDate) return { onTrack: null, daysLate: null };
    const lateMs = projectedDate.getTime() - endOfDay(releaseDate).getTime();
    return lateMs <= 0
      ? { onTrack: true, daysLate: 0 }
      : { onTrack: false, daysLate: Math.ceil(lateMs / DAY_MS) };
  };

  if (remainingIssues === 0) {
    return {
      remainingIssues,
      throughputPerWeek: null,
      basis: null,
      projectedDate: input.totalIssues > 0 ? input.now : null,
      ...verdict(input.totalIssues > 0 ? input.now : null),
    };
  }

  const [done, basis] =
    input.releaseDoneInWindow > 0
      ? [input.releaseDoneInWindow, 'release' as const]
      : input.projectDoneInWindow > 0
        ? [input.projectDoneInWindow, 'project' as const]
        : [0, null];
  if (done === 0 || basis === null) {
    return {
      remainingIssues,
      throughputPerWeek: null,
      basis: null,
      projectedDate: null,
      onTrack: null,
      daysLate: null,
    };
  }

  const perDay = done / ETA_THROUGHPUT_WINDOW_DAYS;
  const projectedDate = new Date(
    input.now.getTime() + Math.ceil(remainingIssues / perDay) * DAY_MS,
  );
  return {
    remainingIssues,
    throughputPerWeek: Math.round(perDay * 7 * 10) / 10,
    basis,
    projectedDate,
    ...verdict(projectedDate),
  };
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}
