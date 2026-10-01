import { projectReleaseEta } from 'src/modules/releases/release-eta.util';

/** Module 9 gap-closure: release ETA projection. */
describe('projectReleaseEta', () => {
  const now = new Date('2026-10-01T12:00:00.000Z');
  const base = {
    totalIssues: 10,
    doneIssues: 2,
    releaseDoneInWindow: 4, // 4 issues per 28 days = 1 per week
    projectDoneInWindow: 20,
    releaseDate: null,
    now,
  };

  it("projects from the release's own recent throughput", () => {
    const eta = projectReleaseEta(base);
    expect(eta).toMatchObject({ remainingIssues: 8, throughputPerWeek: 1, basis: 'release' });
    // 8 remaining at 1/7 per day = 56 days
    expect(eta.projectedDate?.toISOString()).toBe('2026-11-26T12:00:00.000Z');
    expect(eta.onTrack).toBeNull();
  });

  it('falls back to the project-wide rate when the release has no recent completions', () => {
    const eta = projectReleaseEta({ ...base, releaseDoneInWindow: 0 });
    expect(eta.basis).toBe('project');
    expect(eta.throughputPerWeek).toBe(5);
  });

  it('cannot project without any throughput history', () => {
    const eta = projectReleaseEta({ ...base, releaseDoneInWindow: 0, projectDoneInWindow: 0 });
    expect(eta).toMatchObject({ projectedDate: null, basis: null, onTrack: null });
  });

  it('flags on-track vs. late against the target release date', () => {
    expect(
      projectReleaseEta({ ...base, releaseDate: new Date('2026-12-31T00:00:00.000Z') }).onTrack,
    ).toBe(true);
    const late = projectReleaseEta({ ...base, releaseDate: new Date('2026-11-20T00:00:00.000Z') });
    expect(late).toMatchObject({ onTrack: false, daysLate: 6 });
  });

  it('treats a fully done release as complete now, and an empty one as unprojectable', () => {
    expect(projectReleaseEta({ ...base, doneIssues: 10 }).projectedDate).toEqual(now);
    expect(projectReleaseEta({ ...base, totalIssues: 0, doneIssues: 0 }).projectedDate).toBeNull();
  });
});
