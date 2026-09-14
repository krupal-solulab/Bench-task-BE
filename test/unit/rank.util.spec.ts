import {
  RANK_STEP,
  midpointRank,
  needsRenumber,
  nextAppendRank,
  renumberedRanks,
} from 'src/modules/tasks/utils/rank.util';

describe('rank.util', () => {
  describe('nextAppendRank', () => {
    it('returns RANK_STEP for an empty scope', () => {
      expect(nextAppendRank(null)).toBe(RANK_STEP);
    });

    it('returns maxRank + RANK_STEP otherwise', () => {
      expect(nextAppendRank(500)).toBe(500 + RANK_STEP);
    });
  });

  describe('midpointRank', () => {
    it('returns RANK_STEP when the scope is empty', () => {
      expect(midpointRank(null, null)).toBe(RANK_STEP);
    });

    it('moving to the top subtracts RANK_STEP from the current top rank', () => {
      expect(midpointRank(null, 1000)).toBe(1000 - RANK_STEP);
    });

    it('moving to the bottom adds RANK_STEP to the current bottom rank', () => {
      expect(midpointRank(1000, null)).toBe(1000 + RANK_STEP);
    });

    it('moving between two neighbors bisects the gap', () => {
      expect(midpointRank(1000, 2000)).toBe(1500);
    });
  });

  describe('needsRenumber', () => {
    it('is false when either neighbor is missing (top/bottom moves never collide)', () => {
      expect(needsRenumber(null, 1000)).toBe(false);
      expect(needsRenumber(1000, null)).toBe(false);
    });

    it('is false for a normal gap', () => {
      expect(needsRenumber(1000, 2000)).toBe(false);
    });

    it('is true once the gap is smaller than RANK_EPSILON', () => {
      expect(needsRenumber(1000, 1000 + 1e-9)).toBe(true);
    });
  });

  describe('renumberedRanks', () => {
    it('spaces N ranks evenly by RANK_STEP, starting at RANK_STEP', () => {
      expect(renumberedRanks(3)).toEqual([RANK_STEP, RANK_STEP * 2, RANK_STEP * 3]);
    });

    it('returns an empty array for zero items', () => {
      expect(renumberedRanks(0)).toEqual([]);
    });
  });
});
