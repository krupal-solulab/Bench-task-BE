import { ReleaseStatus } from 'src/common/enums/release-status.enum';
import {
  isLegalReleaseTransition,
  legalReleaseTransitions,
} from 'src/modules/releases/release-status.rules';

describe('release-status.rules', () => {
  const ALL_STATUSES = Object.values(ReleaseStatus);

  describe('legalReleaseTransitions', () => {
    it('Unreleased can move to Released or Archived', () => {
      expect(legalReleaseTransitions(ReleaseStatus.UNRELEASED)).toEqual([
        ReleaseStatus.RELEASED,
        ReleaseStatus.ARCHIVED,
      ]);
    });

    it('Released can move back to Unreleased or forward to Archived', () => {
      expect(legalReleaseTransitions(ReleaseStatus.RELEASED)).toEqual([
        ReleaseStatus.UNRELEASED,
        ReleaseStatus.ARCHIVED,
      ]);
    });

    it('Archived is terminal', () => {
      expect(legalReleaseTransitions(ReleaseStatus.ARCHIVED)).toEqual([]);
    });
  });

  describe('isLegalReleaseTransition — exhaustive matrix', () => {
    const expected: Record<ReleaseStatus, Record<ReleaseStatus, boolean>> = {
      [ReleaseStatus.UNRELEASED]: {
        [ReleaseStatus.UNRELEASED]: false,
        [ReleaseStatus.RELEASED]: true,
        [ReleaseStatus.ARCHIVED]: true,
      },
      [ReleaseStatus.RELEASED]: {
        [ReleaseStatus.UNRELEASED]: true,
        [ReleaseStatus.RELEASED]: false,
        [ReleaseStatus.ARCHIVED]: true,
      },
      [ReleaseStatus.ARCHIVED]: {
        [ReleaseStatus.UNRELEASED]: false,
        [ReleaseStatus.RELEASED]: false,
        [ReleaseStatus.ARCHIVED]: false,
      },
    };

    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const legal = expected[from][to];
        it(`${from} -> ${to} is ${legal ? 'legal' : 'illegal'}`, () => {
          expect(isLegalReleaseTransition(from, to)).toBe(legal);
        });
      }
    }
  });
});
